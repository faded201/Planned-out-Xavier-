import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import boto3

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
SECRET_ARN = os.environ.get("STRIPE_WEBHOOK_SECRET_ARN", "")
WRITER_FUNCTION = os.environ.get(
    "ENTITLEMENTS_WRITER_FUNCTION",
    "PlannedOut-Entitlements-Writer",
)
SUBSCRIPTIONS_TABLE = os.environ.get(
    "SUBSCRIPTIONS_TABLE",
    "PlannedOut-Stripe-Subscriptions",
)
TOLERANCE_SECONDS = int(
    os.environ.get("STRIPE_SIGNATURE_TOLERANCE", "300")
)
PRICE_PLAN_MAP = json.loads(
    os.environ.get("PRICE_PLAN_MAP_JSON", "{}")
)
DEFAULT_CHECKOUT_PLAN_MAP = {
    "aud:499": {"plan": "pro", "interval": "month"},
    "aud:4999": {"plan": "pro", "interval": "year"},
    "aud:1999": {"plan": "business", "interval": "month"},
    "aud:19999": {"plan": "business", "interval": "year"},
}
CHECKOUT_PLAN_MAP = json.loads(
    os.environ.get(
        "CHECKOUT_PLAN_MAP_JSON",
        json.dumps(DEFAULT_CHECKOUT_PLAN_MAP),
    )
)
secrets = boto3.client("secretsmanager", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
subscription_table = dynamodb.Table(SUBSCRIPTIONS_TABLE)
_secret_cache = None


def response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload),
    }


def webhook_secret():
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    if not SECRET_ARN:
        raise RuntimeError("Webhook secret is not configured")
    value = secrets.get_secret_value(SecretId=SECRET_ARN)
    _secret_cache = value.get("SecretString", "")
    if not _secret_cache:
        raise RuntimeError("Webhook secret is empty")
    return _secret_cache


def raw_body(event):
    body = event.get("body", "")
    if event.get("isBase64Encoded"):
        return base64.b64decode(body).decode("utf-8")
    if isinstance(body, str):
        return body
    return json.dumps(body, separators=(",", ":"))


def signature_header(event):
    headers = event.get("headers") or {}
    for key, value in headers.items():
        if str(key).lower() == "stripe-signature":
            return str(value)
    return ""


def verify_signature(payload, header):
    parts = {}
    for part in header.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parts.setdefault(key, []).append(value)

    timestamp = int((parts.get("t") or ["0"])[0])
    if (
        not timestamp
        or abs(int(time.time()) - timestamp) > TOLERANCE_SECONDS
    ):
        return False

    signed = f"{timestamp}.{payload}".encode("utf-8")
    expected = hmac.new(
        webhook_secret().encode("utf-8"),
        signed,
        hashlib.sha256,
    ).hexdigest()
    return any(
        hmac.compare_digest(expected, candidate)
        for candidate in parts.get("v1", [])
    )


def iso_from_epoch(value):
    if not value:
        return None
    return datetime.fromtimestamp(
        int(value),
        tz=timezone.utc,
    ).isoformat().replace("+00:00", "Z")


def valid_user_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def map_status(value):
    status = str(value or "").lower()
    if status in {"active", "trialing"}:
        return status
    if status in {"past_due", "unpaid", "incomplete"}:
        return "past_due"
    if status in {"canceled", "cancelled"}:
        return "cancelled"
    return "expired"


def write_entitlement(payload):
    result = lambda_client.invoke(
        FunctionName=WRITER_FUNCTION,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )
    if result.get("FunctionError"):
        raise RuntimeError("Entitlements writer failed")
    raw = result["Payload"].read().decode("utf-8")
    envelope = json.loads(raw or "{}")
    status = int(envelope.get("statusCode", 500))
    body = json.loads(envelope.get("body", "{}"))
    if status >= 400:
        raise RuntimeError(f"Writer rejected event: {status}")
    return body


def load_mapping(subscription_id):
    if not subscription_id:
        return {}
    result = subscription_table.get_item(
        Key={"stripe_subscription_id": subscription_id},
        ConsistentRead=True,
    )
    return result.get("Item") or {}


def save_mapping(
    subscription_id,
    user_id,
    plan,
    interval,
    customer_id,
    checkout_session_id=None,
):
    item = {
        "stripe_subscription_id": subscription_id,
        "user_id": user_id,
        "plan": plan,
        "interval": interval,
        "stripe_customer_id": customer_id or "",
        "updated_at": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    if checkout_session_id:
        item["checkout_session_id"] = checkout_session_id
    subscription_table.put_item(Item=item)


def provisional_expiry(event_created, interval):
    started = datetime.fromtimestamp(
        int(event_created or time.time()),
        tz=timezone.utc,
    )
    days = 370 if interval == "year" else 35
    return (started + timedelta(days=days)).isoformat().replace(
        "+00:00",
        "Z",
    )


def checkout_payload(event):
    obj = event["data"]["object"]
    if str(obj.get("mode") or "") != "subscription":
        return None
    if str(obj.get("payment_status") or "") not in {
        "paid",
        "no_payment_required",
    }:
        return None

    user_id = valid_user_id(obj.get("client_reference_id"))
    metadata = obj.get("metadata") or {}
    currency = str(obj.get("currency") or "").lower().strip()
    amount_key = f"{currency}:{int(obj.get('amount_total') or 0)}"
    amount_mapping = CHECKOUT_PLAN_MAP.get(amount_key) or {}
    plan = str(
        metadata.get("plan")
        or amount_mapping.get("plan")
        or ""
    ).lower().strip()
    interval = str(
        metadata.get("interval")
        or amount_mapping.get("interval")
        or ""
    ).lower().strip()
    subscription_id = str(obj.get("subscription") or "").strip()
    customer_id = str(obj.get("customer") or "").strip()

    if (
        not user_id
        or plan not in {"pro", "business"}
        or interval not in {"month", "year"}
        or not subscription_id
    ):
        return None

    save_mapping(
        subscription_id,
        user_id,
        plan,
        interval,
        customer_id,
        str(obj.get("id") or ""),
    )

    return {
        "user_id": user_id,
        "plan": plan,
        "status": "active",
        "permanent": False,
        "updated_by": "stripe:webhook",
        "event_id": event["id"],
        "event_created": iso_from_epoch(event.get("created")),
        "expires_at": provisional_expiry(
            event.get("created"),
            interval,
        ),
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
    }


def subscription_payload(event):
    obj = event["data"]["object"]
    subscription_id = str(obj.get("id") or "").strip()
    mapping = load_mapping(subscription_id)
    metadata = obj.get("metadata") or {}

    user_id = valid_user_id(
        metadata.get("supabase_user_id")
        or mapping.get("user_id")
    )
    items = ((obj.get("items") or {}).get("data") or [])
    price_ids = [
        str(((item.get("price") or {}).get("id")) or "")
        for item in items
    ]
    mapped_plan = next(
        (
            PRICE_PLAN_MAP.get(price_id)
            for price_id in price_ids
            if PRICE_PLAN_MAP.get(price_id)
        ),
        None,
    )
    plan = str(
        mapped_plan
        or metadata.get("plan")
        or mapping.get("plan")
        or ""
    ).lower().strip()

    intervals = [
        str(((item.get("price") or {}).get("recurring") or {}).get("interval") or "")
        for item in items
    ]
    interval = next(
        (value for value in intervals if value in {"month", "year"}),
        str(mapping.get("interval") or ""),
    )
    if not user_id or plan not in {"pro", "business"}:
        return None

    status = map_status(obj.get("status"))
    period_ends = [
        item.get("current_period_end")
        for item in items
        if item.get("current_period_end")
    ]
    expires_at = iso_from_epoch(
        obj.get("current_period_end")
        or (max(period_ends) if period_ends else None)
    )
    if status in {"active", "trialing"} and not expires_at:
        expires_at = provisional_expiry(
            event.get("created"),
            interval if interval in {"month", "year"} else "month",
        )

    customer_id = str(obj.get("customer") or "")
    save_mapping(
        subscription_id,
        user_id,
        plan,
        interval if interval in {"month", "year"} else "month",
        customer_id,
        mapping.get("checkout_session_id"),
    )

    payload = {
        "user_id": user_id,
        "plan": plan,
        "status": status,
        "permanent": False,
        "updated_by": "stripe:webhook",
        "event_id": event["id"],
        "event_created": iso_from_epoch(event.get("created")),
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
    }
    if expires_at:
        payload["expires_at"] = expires_at
    return payload


def lambda_handler(event, context):
    try:
        payload = raw_body(event)
        if not verify_signature(
            payload,
            signature_header(event),
        ):
            return response(
                400,
                {"error": "Invalid Stripe signature"},
            )

        stripe_event = json.loads(payload)
        event_type = str(stripe_event.get("type") or "")
        if event_type in {
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
        }:
            mutation = checkout_payload(stripe_event)
        elif event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            mutation = subscription_payload(stripe_event)
        else:
            return response(
                200,
                {"received": True, "ignored": True},
            )

        if not mutation:
            return response(
                200,
                {"received": True, "ignored": True},
            )

        result = write_entitlement(mutation)
        return response(
            200,
            {"received": True, "entitlement": result},
        )

    except (ValueError, json.JSONDecodeError):
        return response(
            400,
            {"error": "Invalid webhook payload"},
        )
    except Exception as exc:
        print("Webhook error:", type(exc).__name__)
        return response(
            500,
            {"error": "Webhook processing failed"},
        )
