import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
TABLE_NAME = os.environ.get(
    "ENTITLEMENTS_TABLE",
    "PlannedOut-Xavier-Entitlements"
)
AUDIT_TABLE_NAME = os.environ.get(
    "AUDIT_TABLE",
    "PlannedOut-Membership-Audit"
)

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
audit_table = dynamodb.Table(AUDIT_TABLE_NAME)

VALID_PLANS = {"free", "pro", "business"}
VALID_STATUSES = {
    "active",
    "trialing",
    "past_due",
    "cancelled",
    "expired"
}


def response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        },
        "body": json.dumps(payload)
    }


def iso_datetime(value):
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
        parsed = parsed.astimezone(timezone.utc)
        return parsed.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError):
        return None


def lambda_handler(event, context):
    try:
        # This Lambda is intentionally private.
        # Later the trusted Stripe webhook handler will invoke it.
        body = event.get("body", event)

        if isinstance(body, str):
            body = json.loads(body)

        user_id = str(body.get("user_id", "")).strip()
        plan = str(body.get("plan", "")).lower().strip()
        status = str(body.get("status", "")).lower().strip()

        expires_at = iso_datetime(body.get("expires_at"))
        permanent = body.get("permanent") is True
        updated_by = str(body.get("updated_by", "")).strip()
        event_id = str(body.get("event_id", "")).strip()
        event_created = iso_datetime(body.get("event_created"))

        stripe_customer_id = str(
            body.get("stripe_customer_id", "")
        ).strip()

        stripe_subscription_id = str(
            body.get("stripe_subscription_id", "")
        ).strip()

        if not user_id:
            return response(400, {"error": "user_id is required"})

        if plan not in VALID_PLANS:
            return response(400, {"error": "invalid plan"})

        if status not in VALID_STATUSES:
            return response(400, {"error": "invalid status"})

        if not event_id:
            return response(400, {"error": "event_id is required"})

        if not event_created:
            return response(
                400,
                {"error": "valid event_created is required"}
            )

        # Paid active/trial entitlements require an expiry unless the trusted
        # caller explicitly marks the owner-issued grant as permanent.
        if (
            plan != "free"
            and status in {"active", "trialing"}
            and not permanent
            and not expires_at
        ):
            return response(
                400,
                {"error": "expires_at required for non-permanent paid entitlement"}
            )

        now = datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )

        values = {
            ":plan": plan,
            ":status": status,
            ":event_id": event_id,
            ":event_created": event_created,
            ":updated_at": now
        }

        names = {
            "#plan": "plan",
            "#status": "status"
        }

        values[":permanent"] = permanent
        updates = [
            "#plan = :plan",
            "#status = :status",
            "last_event_id = :event_id",
            "last_event_created = :event_created",
            "updated_at = :updated_at",
            "permanent = :permanent"
        ]

        if updated_by:
            values[":updated_by"] = updated_by
            updates.append("updated_by = :updated_by")

        if expires_at:
            values[":expires_at"] = expires_at
            updates.append("expires_at = :expires_at")

        if stripe_customer_id:
            values[":customer"] = stripe_customer_id
            updates.append("stripe_customer_id = :customer")

        if stripe_subscription_id:
            values[":subscription"] = stripe_subscription_id
            updates.append(
                "stripe_subscription_id = :subscription"
            )

        # Prevent duplicate/older events from replacing newer state.
        table.update_item(
            Key={"user_id": user_id},
            UpdateExpression="SET " + ", ".join(updates),
            ConditionExpression=(
                "(attribute_not_exists(last_event_id) "
                "OR last_event_id <> :event_id) "
                "AND "
                "(attribute_not_exists(last_event_created) "
                "OR last_event_created < :event_created)"
            ),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values
        )

        # Owner/admin mutations are also recorded append-only for traceability.
        if updated_by:
            audit_item = {
                "event_id": event_id,
                "event_created": event_created,
                "actor_id": updated_by,
                "user_id": user_id,
                "plan": plan,
                "status": status,
                "permanent": permanent,
                "updated_at": now
            }
            if expires_at:
                audit_item["expires_at"] = expires_at
            audit_table.put_item(
                Item=audit_item,
                ConditionExpression="attribute_not_exists(event_id)"
            )

        return response(
            200,
            {
                "updated": True,
                "user_id": user_id,
                "plan": plan,
                "status": status
            }
        )

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON"})

    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")

        if code == "ConditionalCheckFailedException":
            return response(
                200,
                {
                    "updated": False,
                    "reason": "duplicate_or_stale_event"
                }
            )

        print(
            "DynamoDB error:",
            code,
            exc.response.get("Error", {}).get("Message")
        )
        return response(500, {"error": "Entitlement update failed"})

    except Exception as exc:
        print(
            f"Entitlement writer error: "
            f"{type(exc).__name__}: {exc}"
        )
        return response(500, {"error": "Entitlement update failed"})
