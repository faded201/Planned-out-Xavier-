import base64
import hashlib
import hmac
import importlib.util
import json
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError


def load(name, folder):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'aws' / folder / 'lambda_function.py')
    module = importlib.util.module_from_spec(spec)
    with patch('boto3.client'), patch('boto3.resource'):
        spec.loader.exec_module(module)
    return module


webhook = load('webhook', 'stripe-webhook')
writer = load('writer', 'entitlements-writer')
USER = '00000000-0000-4000-8000-000000000123'


class WebhookTests(unittest.TestCase):
    def setUp(self):
        webhook._secret_cache = 'test-signing-secret'
        webhook.subscription_table = MagicMock()
        webhook.subscription_table.get_item.return_value = {}
        webhook.PRICE_PLAN_MAP = {'price_pro': 'pro', 'price_business': 'business'}
        webhook.PAYMENT_LINK_PLAN_MAP = {
            f'plink_{plan}_{interval}': {'plan': plan, 'interval': interval}
            for plan in ['pro', 'business'] for interval in ['month', 'year']
        }
        self.event = {'id': 'evt_test', 'created': int(time.time()), 'livemode': True,
                      'type': 'checkout.session.completed', 'data': {'object': {
                          'mode': 'subscription', 'payment_status': 'paid', 'payment_link': 'plink_pro_month',
                          'client_reference_id': USER, 'subscription': 'sub_test', 'customer': 'cus_test', 'id': 'cs_test'}}}

    def signed(self, event=None, encoded=False, timestamp=None):
        body = json.dumps(event or self.event)
        timestamp = timestamp or int(time.time())
        signature = hmac.new(b'test-signing-secret', f'{timestamp}.{body}'.encode(), hashlib.sha256).hexdigest()
        return {'body': base64.b64encode(body.encode()).decode() if encoded else body,
                'isBase64Encoded': encoded, 'headers': {'Stripe-Signature': f't={timestamp},v1={signature}'}}

    def test_all_four_links_map_without_amount_or_metadata(self):
        for plan in ['pro', 'business']:
            for interval in ['month', 'year']:
                obj = self.event['data']['object']
                obj.update(payment_link=f'plink_{plan}_{interval}', amount_total=1, metadata={'plan': 'wrong'})
                result = webhook.checkout_payload(self.event)
                self.assertEqual(result['plan'], plan)
                self.assertEqual(result['event_priority'], 0)

    def test_signing_secret_normalizes_bom_and_whitespace(self):
        webhook._secret_cache = None
        with patch.object(webhook, 'SECRET_ARN', 'test-secret'), patch.object(webhook, 'secrets') as secrets:
            secrets.get_secret_value.return_value = {'SecretString': '\ufeffwhsec_test\r\n'}
            self.assertEqual(webhook.webhook_secret(), 'whsec_test')

    def test_unrelated_same_amount_and_unpaid_checkouts_do_not_grant(self):
        self.event['data']['object'].update(payment_link='plink_other_app', amount_total=499, currency='aud', metadata={'plan': 'pro'})
        self.assertIsNone(webhook.checkout_payload(self.event))
        self.event['data']['object'].update(payment_link='plink_pro_month', payment_status='unpaid')
        self.assertIsNone(webhook.checkout_payload(self.event))
        webhook.subscription_table.put_item.assert_not_called()

    def test_signatures_raw_base64_wrong_mode_and_replay_window(self):
        with patch.object(webhook, 'write_entitlement', return_value={'updated': True}):
            self.assertEqual(webhook.lambda_handler(self.signed(encoded=True), None)['statusCode'], 200)
            tampered = self.signed()
            tampered['body'] += ' '
            self.assertEqual(webhook.lambda_handler(tampered, None)['statusCode'], 400)
            self.assertEqual(webhook.lambda_handler(self.signed(timestamp=int(time.time()) - 600), None)['statusCode'], 400)
            self.event['livemode'] = False
            self.assertEqual(webhook.lambda_handler(self.signed(), None)['statusCode'], 400)

    def subscription(self):
        self.event.update(type='customer.subscription.updated')
        self.event['data']['object'] = {'id': 'sub_test', 'status': 'active', 'customer': 'cus_test',
            'items': {'data': [{'price': {'id': 'price_business', 'recurring': {'interval': 'year'}},
                                'current_period_end': 2000000000}]}}
        return self.event

    def test_subscription_before_checkout_is_retried(self):
        self.subscription()
        self.assertEqual(webhook.lambda_handler(self.signed(), None)['statusCode'], 500)

    def test_current_price_overrides_old_mapping_and_item_period_is_used(self):
        webhook.subscription_table.get_item.return_value = {'Item': {'user_id': USER, 'plan': 'pro', 'interval': 'month'}}
        result = webhook.subscription_payload(self.subscription())
        self.assertEqual(result['plan'], 'business')
        self.assertEqual(result['expires_at'], webhook.iso_from_epoch(2000000000))

    def test_unknown_price_on_known_subscription_fails_closed(self):
        webhook.subscription_table.get_item.return_value = {'Item': {'user_id': USER, 'plan': 'pro'}}
        self.subscription()['data']['object']['items']['data'][0]['price']['id'] = 'price_other'
        with self.assertRaises(RuntimeError):
            webhook.subscription_payload(self.event)

    def test_writer_failure_is_retriable(self):
        with patch.object(webhook, 'write_entitlement', side_effect=RuntimeError('private details')):
            result = webhook.lambda_handler(self.signed(), None)
        self.assertEqual(result['statusCode'], 500)
        self.assertNotIn('private details', result['body'])


class WriterTests(unittest.TestCase):
    def setUp(self):
        writer.table = MagicMock()
        writer.table.get_item.return_value = {}
        writer.dynamodb = MagicMock()
        self.payload = {'user_id': USER, 'plan': 'pro', 'status': 'active', 'expires_at': '2099-01-01T00:00:00Z',
            'event_created': '2026-09-29T12:00:00Z', 'event_id': 'evt_new', 'updated_by': 'stripe:webhook',
            'stripe_subscription_id': 'sub_current', 'event_priority': 1}

    def result(self):
        return writer.lambda_handler(self.payload, None)

    def test_entitlement_and_audit_are_atomic(self):
        self.assertEqual(self.result()['statusCode'], 200)
        transaction = writer.dynamodb.meta.client.transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(len(transaction), 2)
        self.assertIn('Update', transaction[0])
        self.assertIn('Put', transaction[1])
        writer.table.update_item.assert_not_called()

    def test_expiry_requires_timezone(self):
        self.payload['expires_at'] = '2099-01-01'
        self.assertEqual(self.result()['statusCode'], 400)
        writer.dynamodb.meta.client.transact_write_items.assert_not_called()

    def test_duplicate_stale_and_lower_priority_are_ignored(self):
        for current in [{'last_event_id': 'evt_new'},
                        {'last_event_created': '2026-09-29T12:00:00.100Z'},
                        {'last_event_created': '2026-09-29T12:00:00Z', 'last_event_priority': 2}]:
            writer.table.get_item.return_value = {'Item': current}
            self.assertFalse(json.loads(self.result()['body'])['updated'])
        writer.dynamodb.meta.client.transact_write_items.assert_not_called()

    def test_permanent_and_owner_grants_are_protected(self):
        writer.table.get_item.return_value = {'Item': {'permanent': True}}
        self.assertEqual(json.loads(self.result()['body'])['reason'], 'protected_grant')
        writer.table.get_item.return_value = {}
        self.payload['user_id'] = writer.OWNER_USER_ID
        self.assertEqual(json.loads(self.result()['body'])['reason'], 'protected_grant')

    def test_old_subscription_cancellation_cannot_revoke_current_subscription(self):
        writer.table.get_item.return_value = {'Item': {'stripe_subscription_id': 'sub_other'}}
        self.payload['status'] = 'cancelled'
        self.assertEqual(json.loads(self.result()['body'])['reason'], 'different_subscription')

    def test_authoritative_subscription_replaces_later_provisional_checkout(self):
        writer.table.get_item.return_value = {'Item': {'stripe_subscription_id': 'sub_current',
            'last_event_created': '2026-09-29T12:00:01Z', 'last_event_priority': 0, 'last_event_id': 'evt_checkout'}}
        self.assertTrue(json.loads(self.result()['body'])['updated'])
        writer.table.get_item.return_value = {'Item': {'stripe_subscription_id': 'sub_current',
            'last_event_created': '2026-09-29T11:59:59Z', 'last_event_priority': 1, 'last_event_id': 'evt_subscription'}}
        self.payload['event_priority'] = 0
        self.assertEqual(json.loads(self.result()['body'])['reason'], 'authoritative_subscription_exists')

    def test_transaction_conflict_is_retriable_but_audit_duplicate_is_not(self):
        for reasons, status in [([{'Code': 'ConditionalCheckFailed'}, {'Code': 'None'}], 503),
                                ([{'Code': 'None'}, {'Code': 'ConditionalCheckFailed'}], 200)]:
            writer.dynamodb.meta.client.transact_write_items.side_effect = ClientError(
                {'Error': {'Code': 'TransactionCanceledException'}, 'CancellationReasons': reasons}, 'TransactWriteItems')
            self.assertEqual(self.result()['statusCode'], status)


if __name__ == '__main__':
    unittest.main()
