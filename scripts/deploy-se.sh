#!/usr/bin/env bash
# Render and (only when the owner approves) apply the HOSTED build to the SE cluster. This script never builds or pushes an image.
#
#   NAMESPACE=<ns> IMAGE=<registry>/<repo>/cimd-lab:<tag> SE_HOST=<host> PF_BASE_URL=https://<pf> DRY_RUN=1 scripts/deploy-se.sh
#   OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=... SE_HOST=... PF_BASE_URL=... scripts/deploy-se.sh
#
# NAMESPACE, IMAGE, SE_HOST and PF_BASE_URL have no defaults. DRY_RUN=1 prints every rendered manifest, applies nothing, needs no cluster.
# Renders everything to a temp dir first and fails (before any apply) if any __TOKEN__ is left in any file. After a real deploy (not done here): verify by CONTENT (/api/health is demo-health/1 and the
# page carries the hosted banner), check the registry manifest and the pod imageID, then hand over the https:// URL.
# Roll back: kubectl -n "$NAMESPACE" delete -f <rendered files> (or delete the deployment, service, ingress, certificate and configmap named cimd-lab).
set -euo pipefail
cd "$(dirname "$0")/../k8s"

need() { [ -n "${!1:-}" ] || { echo "refusing: set $1 (see the usage lines)" >&2; exit 2; }; }
need NAMESPACE; need IMAGE; need SE_HOST; need PF_BASE_URL
case "$NAMESPACE" in *[!a-z0-9-]*) echo "refusing: NAMESPACE must be a plain name" >&2; exit 2;; esac
case "$IMAGE" in
  *'&'*|*'|'*|*'\'*) echo "refusing: IMAGE must not contain '&', '|' or '\\' (they would corrupt the rendered manifests)" >&2; exit 2;;
esac
case "$IMAGE" in
  *[!A-Za-z0-9._:/@-]*|*:latest|*:HEAD|*:) echo "refusing: IMAGE must be a plain reference with an explicit tag or digest, not latest/HEAD" >&2; exit 2;;
  *:*) ;;
  *) echo "refusing: IMAGE has no tag" >&2; exit 2;;
esac
case "$SE_HOST" in *[!a-z0-9.-]*) echo "refusing: SE_HOST must be a plain host name" >&2; exit 2;; esac
case "$PF_BASE_URL" in
  https://*) ;;
  *) echo "refusing: PF_BASE_URL must start with https://" >&2; exit 2;;
esac
case "$PF_BASE_URL" in *[!A-Za-z0-9._:/-]*|*@*) echo "refusing: PF_BASE_URL must be a plain https address without credentials" >&2; exit 2;; esac

# Render every file into a temp dir and check ALL of them for a leftover __TOKEN__ before anything is printed or applied.
RENDERED="$(mktemp -d)"
trap 'rm -rf "$RENDERED"' EXIT
FILES="configmap.yaml deployment.yaml service.yaml certificate.yaml ingress.yaml"
for f in $FILES; do
  sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" -e "s|__PF_BASE_URL__|$PF_BASE_URL|g" "$f" > "$RENDERED/$f"
done
for f in $FILES; do
  if left="$(grep -oE '__[A-Z0-9_]+__' "$RENDERED/$f" | sort -u)" && [ -n "$left" ]; then
    echo "refusing: unreplaced placeholder(s) in $f: $(echo $left)" >&2; exit 3
  fi
done

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "# DRY RUN: would apply to namespace '$NAMESPACE' (nothing is applied)"
  for f in $FILES; do echo "# --- $f"; cat "$RENDERED/$f"; echo '---'; done
  exit 0
fi
[ "${OWNER_APPROVED:-}" = "1" ] || { echo "refusing: the first SE deploy is owner-approved (set OWNER_APPROVED=1), or use DRY_RUN=1" >&2; exit 2; }
for f in $FILES; do kubectl -n "$NAMESPACE" apply -f "$RENDERED/$f"; done
kubectl -n "$NAMESPACE" rollout status deployment/cimd-lab --timeout=120s
