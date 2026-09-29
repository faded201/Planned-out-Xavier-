"""Offline regression checks; AWS boundary tests are separate from these mocks."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

spec = importlib.util.spec_from_file_location(
    "xavier", Path(__file__).resolve().parents[1] / "aws/xavier/lambda_function.py")
module = importlib.util.module_from_spec(spec)
with patch("boto3.client"), patch("boto3.resource"):
    spec.loader.exec_module(module)


class ConditionalFailure(Exception):
    pass


class XavierTests(unittest.TestCase):
    def setUp(self):
        module.usage_table = MagicMock()
        module.entitlements_table = MagicMock()
        module.entitlements_table.get_item.return_value = {}
        module.bedrock = MagicMock()
        module.bedrock.converse.return_value = {"output": {"message": {"content": [{"text": "A plan"}]}}}
        module.dynamodb.meta.client.exceptions.ConditionalCheckFailedException = ConditionalFailure
        module.usage_table.update_item.return_value = {"Attributes": {"request_count": 1}}
        self.context = MagicMock(aws_request_id="test-request")
        self.event = {"requestContext": {"authorizer": {"jwt": {"claims": {"sub": "test-user"}}}},
                      "body": json.dumps({"message": "Plan my day", "plan": "business", "user_id": "untrusted"})}

    def test_authentication_required_even_for_direct_invocations(self):
        for event in [{"message": "hello"}, {"requestContext": {}, "body": "{}"}]:
            self.assertEqual(module.lambda_handler(event, self.context)["statusCode"], 401)
        module.bedrock.converse.assert_not_called()

    def test_entitlement_fallbacks_and_limits(self):
        cases = [({}, "free"), ({"plan": "pro", "status": "active", "expires_at": "2099-01-01T00:00:00Z"}, "pro"),
                 ({"plan": "business", "status": "active", "expires_at": "2099-01-01T00:00:00Z"}, "business"),
                 ({"plan": "pro", "status": "cancelled", "expires_at": "2099-01-01T00:00:00Z"}, "free"),
                 ({"plan": "pro", "status": "active", "expires_at": "2000-01-01T00:00:00Z"}, "free"),
                 ({"plan": "pro", "status": "active", "expires_at": "bad"}, "free"),
                 ({"plan": "pro", "status": "active", "expires_at": "2099-01-01"}, "free"),
                 ({"plan": "unlimited", "status": "active"}, "free"),
                 ({"plan": "pro", "status": "trialing", "expires_at": "2099-01-01T00:00:00Z"}, "free")]
        for item, expected in cases:
            with self.subTest(item=item):
                module.entitlements_table.get_item.return_value = {"Item": item}
                result = module.lambda_handler(self.event, self.context)
                self.assertEqual(result["statusCode"], 200)
                usage = json.loads(result["body"])["usage"]
                self.assertEqual(usage["plan"], expected)
                self.assertEqual(usage["limit"], {"free": 1000, "pro": 10000, "business": 50000}[expected])

    def test_claim_subject_is_used_and_ttl_written(self):
        result = module.lambda_handler(self.event, self.context)
        self.assertEqual(result["statusCode"], 200)
        for call in module.usage_table.update_item.call_args_list:
            self.assertEqual(call.kwargs["Key"]["user_id"], "test-user")
        admitted = module.usage_table.update_item.call_args_list[0].kwargs
        self.assertIn(":ttl", admitted["ExpressionAttributeValues"])
        self.assertEqual(module.usage_table.update_item.call_args.kwargs["ExpressionAttributeNames"], {"#outcome": "successful_count"})

    def test_burst_and_monthly_limits_stop_inference(self):
        for responses in [[ConditionalFailure()], [{"Attributes": {"request_count": 1}}, ConditionalFailure()]]:
            module.usage_table.update_item.side_effect = responses
            result = module.lambda_handler(self.event, self.context)
            self.assertEqual(result["statusCode"], 429)
        module.bedrock.converse.assert_not_called()

    def test_failure_count_and_safe_error(self):
        module.bedrock.converse.side_effect = ClientError({"Error": {"Code": "InternalServerException", "Message": "secret"}}, "Converse")
        result = module.lambda_handler(self.event, self.context)
        self.assertEqual(result["statusCode"], 500)
        self.assertNotIn("secret", result["body"])
        self.assertEqual(module.usage_table.update_item.call_args.kwargs["ExpressionAttributeNames"], {"#outcome": "failed_count"})

    def test_invalid_body_rejected_before_metering(self):
        for body in ['{broken', '[]', '{"message":4}', '{"message":""}', json.dumps({"message": "x" * 12001})]:
            result = module.lambda_handler({**self.event, "body": body}, self.context)
            self.assertEqual(result["statusCode"], 400)
        module.usage_table.update_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
