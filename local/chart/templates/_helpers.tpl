{{- define "foodiguard.apiImage" -}}
{{ .Values.registry }}/foodiguard-api:{{ required "set tag to the built commit" .Values.tag }}
{{- end -}}
{{- define "foodiguard.dbEnv" -}}
- {name: DB_HOST, value: postgres}
- {name: DB_NAME, value: foodiguard}
- {name: DB_USER, value: postgres}
- name: DB_PASSWORD
  valueFrom: {secretKeyRef: {name: db-credentials, key: DB_PASSWORD}}
{{- end -}}
