# Only the primary channel is attached to alert policies. The legacy team
# channel remains imported for inventory but receives no FoodiGuard alerts.
resource "google_monitoring_notification_channel" "primary" {
  project      = var.project_id
  display_name = "FoodiGuard 운영 - 담당자"
  description  = "FoodiGuard 운영 장애 및 복구 경보"
  type         = "email"
  labels = {
    email_address = "operator@example.com"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_monitoring_notification_channel" "legacy_team" {
  count        = var.create_legacy_team_channel ? 1 : 0
  project      = var.project_id
  display_name = "FoodiGuard 운영 - 팀"
  description  = "FoodiGuard 운영 장애 및 복구 경보"
  type         = "email"
  labels = {
    email_address = "team@example.com"
  }

  lifecycle {
    prevent_destroy = true
  }
}
