import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

import boto3

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
SECRET_ARN = os.environ.get("STRIPE_WEBHOOK_SECRET_ARN", "")
WRITER_FUNCTION = os.environ.get(
    "ENTITLEMENTS_WRITER_FUNCTION",
    "PlannedOut-Entitlements-Writer"
)
TOLERANCE_SECONDS = int(os.environ.get("STRIPE_SIGNATURE_TOLERANCE", "300"))
PRICE_PLAN_MAP = json.loads(os.environ.get("PRICE_PLAN_MAP_JSON", "{}"))

secrets = boto3.client("secretsmanager", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
_secret_cache = None
def response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        },
        "body": json.dumps(payload)
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
    return body if isinstance(body, str) else json.dumps(body, separators=(",", ":"))


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
    if not timestamp or abs(int(time.time()) - timestamp) > TOLERANCE_SECONDS:
        return False
    signed = f"{timestamp}.{payload}".encode("utf-8")
    expected = hmac.new(
        webhook_secret().encode("utf-8"),
        signed,
        hashlib.sha256
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
        tz=timezone.utc
    ).isoformat().replace("+00:00", "Z")
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
        Payload=json.dumps(payload).encode("utf-8")
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
def subscription_payload(event):
    obj = event["data"]["object"]
    metadata = obj.get("metadata") or {}
    user_id = str(metadata.get("supabase_user_id") or "").strip()
    items = ((obj.get("items") or {}).get("data") or [])
    price_ids = [str(((item.get("price") or {}).get("id")) or "") for item in items]
    mapped_plan = next((PRICE_PLAN_MAP.get(price_id) for price_id in price_ids if PRICE_PLAN_MAP.get(price_id)), None)
    plan = str(mapped_plan or metadata.get("plan") or "").lower().strip()
    if not user_id or plan not in {"pro", "business"}:
        return None

    status = map_status(obj.get("status"))
    period_ends = [item.get("current_period_end") for item in items if item.get("current_period_end")]
    expires_at = iso_from_epoch(obj.get("current_period_end") or (max(period_ends) if period_ends else None))
    if status in {"active", "trialing"} and not expires_at:
        raise RuntimeError("Active subscription is missing current_period_end")

    payload = {
        "user_id": user_id,
        "plan": plan,
        "status": status,
        "permanent": False,
        "updated_by": "stripe:webhook",
        "event_id": event["id"],
        "event_created": iso_from_epoch(event.get("created")),
        "stripe_customer_id": str(obj.get("customer") or ""),
        "stripe_subscription_id": str(obj.get("id") or "")
    }
    if expires_at:
        payload["expires_at"] = expires_at
    return payload


def lambda_handler(event, context):
    try:
        payload = raw_body(event)
        if not verify_signature(payload, signature_header(event)):
            return response(400, {"error": "Invalid Stripe signature"})

        stripe_event = json.loads(payload)
        event_type = str(stripe_event.get("type") or "")
        if event_type not in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted"
        }:
            return response(200, {"received": True, "ignored": True})

        mutation = subscription_payload(stripe_event)
        if not mutation:
            return response(200, {"received": True, "ignored": True})

        result = write_entitlement(mutation)
        return response(200, {"received": True, "entitlement": result})

    except (ValueError, json.JSONDecodeError):
        return response(400, {"error": "Invalid webhook payload"})
    except Exception as exc:
        print("Webhook error:", type(exc).__name__)
        return response(500, {"error": "Webhook processing failed"})
