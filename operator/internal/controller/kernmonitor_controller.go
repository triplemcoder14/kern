package controller

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/apimachinery/pkg/api/resource"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	kernv1alpha1 "github.com/kern/operator/api/v1alpha1"
)

const (
	labelManagedBy = "app.kubernetes.io/managed-by"
	labelMonitor   = "kern.io/monitor"
	managerName    = "kern-operator"
	conditionReady = "Ready"
)

type KernMonitorReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

func (r *KernMonitorReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	monitor := &kernv1alpha1.KernMonitor{}
	if err := r.Get(ctx, types.NamespacedName{Name: req.Name}, monitor); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	ns := monitor.Spec.Namespace
	if ns == "" {
		ns = "kern"
	}

	spec := normalizeSpec(monitor.Spec)

	if err := r.ensureNamespace(ctx, ns, monitor.Name); err != nil {
		return r.failStatus(ctx, monitor, err)
	}
	if err := r.ensureAgentRBAC(ctx, ns, monitor.Name); err != nil {
		return r.failStatus(ctx, monitor, err)
	}
	if err := r.ensureAgentDaemonSet(ctx, ns, monitor.Name, spec); err != nil {
		return r.failStatus(ctx, monitor, err)
	}
	if err := r.ensureAgentService(ctx, ns, monitor.Name, spec.Agent.Port); err != nil {
		return r.failStatus(ctx, monitor, err)
	}

	desired, ready, err := r.agentNodeCounts(ctx, ns, monitor.Name)
	if err != nil {
		return r.failStatus(ctx, monitor, err)
	}

	phase := "Progressing"
	message := "Agent DaemonSet rolling out"
	if desired > 0 && ready == desired {
		phase = "Ready"
		message = fmt.Sprintf("Agent running on %d/%d nodes", ready, desired)
	}

	monitor.Status.Phase = phase
	monitor.Status.Mode = spec.Agent.Mode
	monitor.Status.NodesDesired = desired
	monitor.Status.NodesReady = ready
	monitor.Status.AgentService = fmt.Sprintf("%s.%s.svc.cluster.local:%d", agentServiceName(monitor.Name), ns, spec.Agent.Port)
	monitor.Status.Message = message
	setCondition(&monitor.Status.Conditions, conditionReady, phase == "Ready", message)

	if err := r.Status().Update(ctx, monitor); err != nil {
		logger.Error(err, "status update failed")
		return ctrl.Result{}, err
	}

	if phase != "Ready" {
		return ctrl.Result{RequeueAfter: 15 * time.Second}, nil
	}
	return ctrl.Result{RequeueAfter: 60 * time.Second}, nil
}

func (r *KernMonitorReconciler) failStatus(ctx context.Context, monitor *kernv1alpha1.KernMonitor, err error) (ctrl.Result, error) {
	monitor.Status.Phase = "Failed"
	monitor.Status.Message = err.Error()
	setCondition(&monitor.Status.Conditions, conditionReady, false, err.Error())
	_ = r.Status().Update(ctx, monitor)
	return ctrl.Result{}, err
}

func (r *KernMonitorReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&kernv1alpha1.KernMonitor{}).
		Complete(r)
}

func normalizeSpec(spec kernv1alpha1.KernMonitorSpec) kernv1alpha1.KernMonitorSpec {
	if spec.Namespace == "" {
		spec.Namespace = "kern"
	}
	if spec.Agent.Image == "" {
		spec.Agent.Image = "kern/agent:latest"
	}
	if spec.Agent.Mode == "" {
		spec.Agent.Mode = "auto"
	}
	if spec.Agent.Port == 0 {
		spec.Agent.Port = 9474
	}
	if spec.Agent.ImagePullPolicy == "" {
		spec.Agent.ImagePullPolicy = string(corev1.PullIfNotPresent)
	}
	return spec
}

func monitorLabels(monitorName string) map[string]string {
	return map[string]string{
		labelManagedBy: managerName,
		labelMonitor:   monitorName,
		"app":          "kern-agent",
	}
}

func agentDaemonSetName(monitorName string) string {
	if monitorName == "default" {
		return "kern-agent"
	}
	return "kern-agent-" + monitorName
}

func agentServiceName(monitorName string) string {
	if monitorName == "default" {
		return "kern-agent"
	}
	return "kern-agent-" + monitorName
}

func agentServiceAccountName(monitorName string) string {
	if monitorName == "default" {
		return "kern-agent"
	}
	return "kern-agent-" + monitorName
}

func agentClusterRoleName(monitorName string) string {
	if monitorName == "default" {
		return "kern-agent"
	}
	return "kern-agent-" + monitorName
}

func (r *KernMonitorReconciler) ensureNamespace(ctx context.Context, ns, monitorName string) error {
	obj := &corev1.Namespace{}
	err := r.Get(ctx, types.NamespacedName{Name: ns}, obj)
	if err == nil {
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	return r.Create(ctx, &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:   ns,
			Labels: monitorLabels(monitorName),
		},
	})
}

func (r *KernMonitorReconciler) ensureAgentRBAC(ctx context.Context, ns, monitorName string) error {
	saName := agentServiceAccountName(monitorName)
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      saName,
			Namespace: ns,
			Labels:    monitorLabels(monitorName),
		},
	}
	if err := r.createOrUpdate(ctx, sa, func(current client.Object) {
		current.(*corev1.ServiceAccount).Labels = sa.Labels
	}); err != nil {
		return err
	}

	roleName := agentClusterRoleName(monitorName)
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:   roleName,
			Labels: monitorLabels(monitorName),
		},
		Rules: []rbacv1.PolicyRule{
			{APIGroups: []string{""}, Resources: []string{"pods"}, Verbs: []string{"get", "list", "watch"}},
			{APIGroups: []string{""}, Resources: []string{"services"}, Verbs: []string{"get", "list", "watch"}},
			{APIGroups: []string{"discovery.k8s.io"}, Resources: []string{"endpointslices"}, Verbs: []string{"get", "list", "watch"}},
		},
	}
	// OpenShift blocks RBAC escalation: cluster-admin (Helm) should provision agent
	// ClusterRole/Binding; the operator only creates them when absent.
	if err := r.ensureClusterObject(ctx, cr); err != nil {
		return err
	}

	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   roleName,
			Labels: monitorLabels(monitorName),
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     roleName,
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      saName,
			Namespace: ns,
		}},
	}
	return r.ensureClusterObject(ctx, crb)
}

func (r *KernMonitorReconciler) ensureAgentDaemonSet(ctx context.Context, ns, monitorName string, spec kernv1alpha1.KernMonitorSpec) error {
	name := agentDaemonSetName(monitorName)
	labels := monitorLabels(monitorName)
	port := spec.Agent.Port

	args := []string{"-addr", fmt.Sprintf(":%d", port), "-mode", spec.Agent.Mode}
	if spec.Agent.HubbleRelay != "" {
		args = append(args, "-hubble-relay", spec.Agent.HubbleRelay)
	}

	desired := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    labels,
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					ServiceAccountName: agentServiceAccountName(monitorName),
					HostNetwork:        true,
					DNSPolicy:          corev1.DNSClusterFirstWithHostNet,
					Tolerations:        []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
					Containers: []corev1.Container{{
						Name:            "agent",
						Image:           spec.Agent.Image,
						ImagePullPolicy: corev1.PullPolicy(spec.Agent.ImagePullPolicy),
						Args:            args,
						Ports:           []corev1.ContainerPort{{Name: "http", ContainerPort: port, Protocol: corev1.ProtocolTCP}},
						Env: []corev1.EnvVar{{
							Name: "NODE_NAME",
							ValueFrom: &corev1.EnvVarSource{
								FieldRef: &corev1.ObjectFieldSelector{FieldPath: "spec.nodeName"},
							},
						}},
						SecurityContext: &corev1.SecurityContext{
							Privileged: boolPtr(true),
							RunAsUser:  int64Ptr(0),
						},
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resourceQuantity("50m"),
								corev1.ResourceMemory: resourceQuantity("64Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resourceQuantity("200m"),
								corev1.ResourceMemory: resourceQuantity("128Mi"),
							},
						},
					}},
				},
			},
		},
	}

	return r.createOrUpdate(ctx, desired, func(current client.Object) {
		cur := current.(*appsv1.DaemonSet)
		cur.Labels = desired.Labels
		cur.Spec = desired.Spec
	})
}

func (r *KernMonitorReconciler) ensureAgentService(ctx context.Context, ns, monitorName string, port int32) error {
	name := agentServiceName(monitorName)
	labels := monitorLabels(monitorName)

	desired := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    labels,
		},
		Spec: corev1.ServiceSpec{
			Selector: labels,
			Ports: []corev1.ServicePort{{
				Name:       "http",
				Port:       port,
				TargetPort: intstr.FromInt32(port),
				Protocol:   corev1.ProtocolTCP,
			}},
		},
	}
	return r.createOrUpdate(ctx, desired, func(current client.Object) {
		cur := current.(*corev1.Service)
		cur.Labels = desired.Labels
		cur.Spec.Selector = desired.Spec.Selector
		cur.Spec.Ports = desired.Spec.Ports
	})
}

func (r *KernMonitorReconciler) agentNodeCounts(ctx context.Context, ns, monitorName string) (int32, int32, error) {
	ds := &appsv1.DaemonSet{}
	if err := r.Get(ctx, types.NamespacedName{Namespace: ns, Name: agentDaemonSetName(monitorName)}, ds); err != nil {
		return 0, 0, err
	}
	return ds.Status.DesiredNumberScheduled, ds.Status.NumberReady, nil
}

func (r *KernMonitorReconciler) createOrUpdate(ctx context.Context, desired client.Object, mutate func(current client.Object)) error {
	key := client.ObjectKeyFromObject(desired)
	current := desired.DeepCopyObject().(client.Object)
	if err := r.Get(ctx, key, current); apierrors.IsNotFound(err) {
		return r.Create(ctx, desired)
	} else if err != nil {
		return err
	}
	mutate(current)
	return r.Update(ctx, current)
}

// ensureClusterObject creates cluster-scoped RBAC once. Updates are skipped so
// OpenShift does not reject RBAC escalation when Helm/cluster-admin provisions rules.
func (r *KernMonitorReconciler) ensureClusterObject(ctx context.Context, desired client.Object) error {
	key := client.ObjectKeyFromObject(desired)
	current := desired.DeepCopyObject().(client.Object)
	if err := r.Get(ctx, key, current); apierrors.IsNotFound(err) {
		return r.Create(ctx, desired)
	}
	return client.IgnoreNotFound(err)
}

func setCondition(conditions *[]metav1.Condition, condType string, ready bool, message string) {
	status := metav1.ConditionFalse
	if ready {
		status = metav1.ConditionTrue
	}
	now := metav1.Now()
	for i := range *conditions {
		if (*conditions)[i].Type == condType {
			(*conditions)[i].Status = status
			(*conditions)[i].Reason = condType
			(*conditions)[i].Message = message
			(*conditions)[i].LastTransitionTime = now
			return
		}
	}
	*conditions = append(*conditions, metav1.Condition{
		Type:               condType,
		Status:             status,
		Reason:             condType,
		Message:            message,
		LastTransitionTime: now,
	})
}

func boolPtr(v bool) *bool    { return &v }
func int64Ptr(v int64) *int64 { return &v }

func resourceQuantity(value string) resource.Quantity {
	q, err := resource.ParseQuantity(value)
	if err != nil {
		return resource.MustParse("0")
	}
	return q
}
