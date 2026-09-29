import json
import boto3
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from boto3.dynamodb.conditions import Attr
from botocore.config import Config

REGION = "ap-southeast-2"

bedrock = boto3.client("bedrock-runtime", region_name=REGION,
    config=Config(connect_timeout=2, read_timeout=15, retries={"total_max_attempts": 1}))
lambda_client = boto3.client("lambda", region_name=REGION,
    config=Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 1}))
dynamodb = boto3.resource("dynamodb", region_name=REGION,
    config=Config(connect_timeout=2, read_timeout=2, retries={"total_max_attempts": 1}))

MODEL_ID = os.environ.get("MODEL_ID", "apac.amazon.nova-lite-v1:0")
USAGE_TABLE = os.environ.get("USAGE_TABLE", "PlannedOut-Xavier-Usage")
ENTITLEMENTS_TABLE = os.environ.get(
    "ENTITLEMENTS_TABLE",
    "PlannedOut-Xavier-Entitlements"
)

PLAN_LIMITS = {
    "free": int(os.environ.get("FREE_MONTHLY_LIMIT", "1000")),
    "pro": int(os.environ.get("PRO_MONTHLY_LIMIT", "10000")),
    "business": int(os.environ.get("BUSINESS_MONTHLY_LIMIT", "50000")),
}

BURST_LIMIT = int(os.environ.get("BURST_LIMIT", "20"))
OWNER_USER_ID = os.environ.get("OWNER_USER_ID", "06b5e7ce-9624-4afb-b2e9-24fc095038d5")
ENTITLEMENTS_WRITER_FUNCTION = os.environ.get(
    "ENTITLEMENTS_WRITER_FUNCTION", "PlannedOut-Entitlements-Writer"
)

usage_table = dynamodb.Table(USAGE_TABLE)
entitlements_table = dynamodb.Table(ENTITLEMENTS_TABLE)


def api_response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        },
        "body": json.dumps(payload)
    }


def authenticated_user(event):
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        subject = claims.get("sub")
        return str(subject) if subject else None
    except (KeyError, TypeError, AttributeError):
        return None


def parse_expiry(value):
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def get_entitlement(user_id):
    result = entitlements_table.get_item(
        Key={"user_id": user_id},
        ConsistentRead=True
    )

    item = result.get("Item")

    if user_id == OWNER_USER_ID:
        return {"plan": "business", "status": "owner", "expires_at": None}

    # Missing record = Free.
    if not item:
        return {
            "plan": "free",
            "status": "default",
            "expires_at": None
        }

    plan = str(item.get("plan", "free")).lower()
    status = str(item.get("status", "")).lower()
    expires_at = item.get("expires_at")

    # Unknown plans are never trusted.
    if plan not in PLAN_LIMITS:
        plan = "free"

    # Paid plans must explicitly be active.
    if plan != "free" and status != "active":
        return {
            "plan": "free",
            "status": "fallback",
            "expires_at": None
        }

    # Permanent owner-issued grants do not expire.
    if plan != "free" and item.get("permanent") is True:
        return {"plan": plan, "status": status, "expires_at": None}

    # Paid plans require a valid future expiry.
    if plan != "free":
        expiry = parse_expiry(expires_at)

        if expiry is None or expiry <= datetime.now(timezone.utc):
            return {
                "plan": "free",
                "status": "fallback",
                "expires_at": None
            }

    return {
        "plan": plan,
        "status": status or "active",
        "expires_at": expires_at
    }


def increment_counter(user_id, period, limit):
    now = datetime.now(timezone.utc)
    # Expired counters cannot collide with current periods; TTL is only cleanup.
    ttl = int((now + timedelta(days=2 if period.startswith("minute#") else 93)).timestamp())
    result = usage_table.update_item(
        Key={
            "user_id": user_id,
            "period": period
        },
        UpdateExpression=(
            "SET request_count = if_not_exists(request_count, :zero) + :one, "
            "updated_at = :now, expires_at_epoch = :ttl"
        ),
        ConditionExpression=Attr("request_count").not_exists() | Attr("request_count").lt(limit),
        ExpressionAttributeValues={
            ":zero": 0,
            ":one": 1,
            ":now": now.isoformat(),
            ":ttl": ttl
        },
        ReturnValues="ALL_NEW"
    )

    return int(result["Attributes"]["request_count"])


def record_outcome(user_id, period, succeeded):
    field = "successful_count" if succeeded else "failed_count"
    usage_table.update_item(
        Key={"user_id": user_id, "period": period},
        UpdateExpression="SET updated_at = :now ADD #outcome :one",
        ExpressionAttributeNames={"#outcome": field},
        ExpressionAttributeValues={":one": 1, ":now": datetime.now(timezone.utc).isoformat()}
    )


def handle_admin_membership(event, actor_id):
    if actor_id != OWNER_USER_ID:
        return api_response(403, {"error": "Owner access required"})
    body = event.get("body", {})
    if isinstance(body, str):
        body = json.loads(body)
    if not isinstance(body, dict):
        return api_response(400, {"error": "Invalid request"})
    target = str(body.get("userId", "")).strip()
    plan = str(body.get("plan", "")).lower()
    permanent = body.get("permanent") is True
    try:
        target = str(uuid.UUID(target))
    except (ValueError, AttributeError, TypeError):
        return api_response(400, {"error": "Valid userId and plan are required"})
    if plan not in PLAN_LIMITS:
        return api_response(400, {"error": "Valid userId and plan are required"})
    expires_at = None
    if plan != "free" and not permanent:
        expiry = parse_expiry(body.get("expiresAt"))
        if expiry is None or expiry <= datetime.now(timezone.utc):
            return api_response(400, {"error": "Future expiry required"})
        expires_at = expiry.isoformat()
    now = datetime.now(timezone.utc)
    writer_event = {
        "user_id": target,
        "plan": plan,
        "status": "active" if plan != "free" else "expired",
        "permanent": permanent,
        "updated_by": actor_id,
        "event_id": "admin-" + str(event.get("requestContext", {}).get("requestId", now.timestamp())),
        "event_created": now.isoformat()
    }
    if expires_at:
        writer_event["expires_at"] = expires_at
    invoke = lambda_client.invoke(
        FunctionName=ENTITLEMENTS_WRITER_FUNCTION,
        InvocationType="RequestResponse",
        Payload=json.dumps(writer_event).encode("utf-8")
    )
    writer_result = json.loads(invoke["Payload"].read().decode("utf-8"))
    writer_status = int(writer_result.get("statusCode", 500))
    writer_body = writer_result.get("body", "{}")
    try:
        writer_body = json.loads(writer_body) if isinstance(writer_body, str) else writer_body
    except json.JSONDecodeError:
        writer_body = {"error": "Invalid writer response"}
    if writer_status >= 400:
        return api_response(502, {"error": "Membership update failed"})
    return api_response(200, {"updated": writer_body.get("updated", False), "userId": target, "plan": plan,
                              "permanent": permanent, "expiresAt": expires_at})


def lambda_handler(event, context):
    admitted_period = None
    inference_succeeded = False
    try:
        user_id = authenticated_user(event)

        if not user_id:
            return api_response(401, {"error": "Unauthorized"})

        if event.get("rawPath") == "/admin/memberships":
            return handle_admin_membership(event, user_id)

        body = event.get("body", event)

        if isinstance(body, str):
            body = json.loads(body)

        if not isinstance(body, dict) or not isinstance(body.get("message"), str):
            return api_response(400, {"error": "message must be a string"})
        message = body["message"].strip()

        if not message:
            return api_response(400, {"error": "message is required"})

        if len(message) > 12000:
            return api_response(400, {"error": "message is too long"})

        usage = None

        if user_id:
            now = datetime.now(timezone.utc)

            entitlement = get_entitlement(user_id)
            plan = entitlement["plan"]
            monthly_limit = PLAN_LIMITS[plan]

            minute_period = "minute#" + now.strftime("%Y-%m-%dT%H:%M")

            try:
                increment_counter(
                    user_id,
                    minute_period,
                    BURST_LIMIT
                )
            except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
                return api_response(
                    429,
                    {
                        "error": "Too many Xavier requests",
                        "retry_after_seconds": 60
                    }
                )

            month_period = "month#" + now.strftime("%Y-%m")

            try:
                used = increment_counter(
                    user_id,
                    month_period,
                    monthly_limit
                )
            except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
                return api_response(
                    429,
                    {
                        "error": "Monthly Xavier allowance reached",
                        "plan": plan,
                        "limit": monthly_limit
                    }
                )

            usage = {
                "plan": plan,
                "period": now.strftime("%Y-%m"),
                "used": used,
                "limit": monthly_limit,
                "remaining": max(0, monthly_limit - used)
            }
            admitted_period = month_period

        result = bedrock.converse(
            modelId=MODEL_ID,
            system=[{
                "text": (
                    "You are Xavier, the AI intelligence built into Planned Out. "
                    "Be concise, practical and action-oriented. "
                    "Never claim that a Planned Out action occurred unless the "
                    "application confirms that it actually executed."
                )
            }],
            messages=[{
                "role": "user",
                "content": [{"text": message}]
            }],
            inferenceConfig={
                "maxTokens": 500,
                "temperature": 0.3
            }
        )

        answer = result["output"]["message"]["content"][0]["text"]
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Invalid inference response")
        inference_succeeded = True
        record_outcome(user_id, admitted_period, True)

        payload = {
            "assistant": "Xavier",
            "model": MODEL_ID,
            "reply": answer,
            "requestId": getattr(context, "aws_request_id", None)
        }

        if usage:
            payload["usage"] = usage

        return api_response(200, payload)

    except json.JSONDecodeError:
        return api_response(400, {"error": "Invalid JSON"})

    except Exception as exc:
        # Log only error categories and AWS request IDs, never input or tokens.
        print(json.dumps({"event": "xavier_failure", "type": type(exc).__name__,
            "requestId": getattr(context, "aws_request_id", None)}))
        if admitted_period and not inference_succeeded:
            try:
                record_outcome(user_id, admitted_period, False)
            except Exception as counter_error:
                print(json.dumps({"event": "xavier_counter_failure", "type": type(counter_error).__name__}))
        return api_response(500, {"error": "Xavier inference failed",
            "requestId": getattr(context, "aws_request_id", None)})
