{{- define "kern.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kern.fullname" -}}
{{- printf "%s" (include "kern.name" .) -}}
{{- end -}}

{{- define "kern.labels" -}}
app.kubernetes.io/name: {{ include "kern.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
