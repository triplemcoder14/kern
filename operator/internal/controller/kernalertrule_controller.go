package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	kernv1alpha1 "github.com/kern/operator/api/v1alpha1"
)

const (
	alertRulesConfigMap = "kern-alert-rules"
	alertRulesDataKey   = "rules.json"
)

type declarativeAlertRule struct {
	ID       string                     `json:"id"`
	Enabled  bool                       `json:"enabled"`
	Type     string                     `json:"type"`
	Severity string                     `json:"severity"`
	Threshold *kernv1alpha1.AlertRuleThreshold `json:"threshold,omitempty"`
	Match    *kernv1alpha1.AlertRuleMatch     `json:"match,omitempty"`
	Title    string                     `json:"title,omitempty"`
	Cause    string                     `json:"cause,omitempty"`
}

type KernAlertRuleReconciler struct {
	client.Client
	Scheme    *runtime.Scheme
	Namespace string
}

func (r *KernAlertRuleReconciler) Reconcile(ctx context.Context, _ ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)
	ns := r.Namespace
	if ns == "" {
		ns = "kern"
	}

	list := &kernv1alpha1.KernAlertRuleList{}
	if err := r.List(ctx, list); err != nil {
		return ctrl.Result{}, err
	}

	rules := make([]declarativeAlertRule, 0, len(list.Items))
	for _, item := range list.Items {
		if !item.Spec.Enabled && item.Spec.Type == "" {
			continue
		}
		if !item.Spec.Enabled {
			continue
		}
		rules = append(rules, declarativeAlertRule{
			ID:        fmt.Sprintf("crd:%s:%s", item.Namespace, item.Name),
			Enabled:   true,
			Type:      item.Spec.Type,
			Severity:  item.Spec.Severity,
			Threshold: item.Spec.Threshold,
			Match:     item.Spec.Match,
			Title:     item.Spec.Title,
			Cause:     item.Spec.Cause,
		})
	}

	payload, err := json.Marshal(rules)
	if err != nil {
		return ctrl.Result{}, err
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      alertRulesConfigMap,
			Namespace: ns,
			Labels: map[string]string{
				labelManagedBy: managerName,
				"kern.io/component": "alert-rules",
			},
		},
		Data: map[string]string{
			alertRulesDataKey: string(payload),
		},
	}

	if err := r.createOrUpdateConfigMap(ctx, cm); err != nil {
		return ctrl.Result{}, err
	}

	logger.Info("synced alert rules", "count", len(rules), "namespace", ns)
	return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}

func (r *KernAlertRuleReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&kernv1alpha1.KernAlertRule{}).
		Complete(r)
}

func (r *KernAlertRuleReconciler) createOrUpdateConfigMap(ctx context.Context, desired *corev1.ConfigMap) error {
	key := types.NamespacedName{Namespace: desired.Namespace, Name: desired.Name}
	current := &corev1.ConfigMap{}
	if err := r.Get(ctx, key, current); apierrors.IsNotFound(err) {
		return r.Create(ctx, desired)
	} else if err != nil {
		return err
	}
	current.Labels = desired.Labels
	current.Data = desired.Data
	return r.Update(ctx, current)
}
