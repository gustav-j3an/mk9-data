#!/usr/bin/env bash
# Restrict the disposable PostgreSQL container to its private Docker subnet.
# Invoke after Docker/Supabase has downloaded and started its pinned images.
set -Eeuo pipefail
ACTION="${1:?usage: rc1-25-egress-guard.sh enable <container-id> | disable}"
CHAIN="MK9_REHEARSAL_DOCKER_EGRESS"
case "$ACTION" in
  enable)
    CONTAINER_ID="${2:?container id required}"
    command -v iptables >/dev/null
    docker inspect "$CONTAINER_ID" >/dev/null
    mapfile -t NETWORKS < <(docker inspect --format '{{range $name, $net := .NetworkSettings.Networks}}{{printf "%s %s\\n" $name $net.IPAddress}}{{end}}' "$CONTAINER_ID")
    if [[ "${#NETWORKS[@]}" -ne 1 ]]; then
      echo "FALHA: PostgreSQL must be attached to exactly one Docker network." >&2
      exit 1
    fi
    read -r NETWORK_NAME CONTAINER_IP <<< "${NETWORKS[0]}"
    NETWORK_SUBNET="$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$NETWORK_NAME")"
    [[ "$CONTAINER_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
    [[ "$NETWORK_SUBNET" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]]
    iptables -S DOCKER-USER >/dev/null 2>&1 || {
      echo "FALHA: Docker DOCKER-USER chain unavailable; refusing rehearsal." >&2
      exit 1
    }
    iptables -S "$CHAIN" >/dev/null 2>&1 && {
      echo "FALHA: stale egress guard chain exists." >&2
      exit 1
    }
    iptables -N "$CHAIN"
    iptables -A "$CHAIN" -s "$CONTAINER_IP" -d "$NETWORK_SUBNET" -j RETURN
    iptables -A "$CHAIN" -s "$CONTAINER_IP" -j REJECT
    iptables -A "$CHAIN" -j RETURN
    iptables -I DOCKER-USER 1 -j "$CHAIN"
    iptables -C DOCKER-USER -j "$CHAIN"
    iptables -C "$CHAIN" -s "$CONTAINER_IP" -d "$NETWORK_SUBNET" -j RETURN
    iptables -C "$CHAIN" -s "$CONTAINER_IP" -j REJECT
    echo "PostgreSQL container egress blocked outside its private Docker subnet."
    ;;
  disable)
    while iptables -C DOCKER-USER -j "$CHAIN" >/dev/null 2>&1; do iptables -D DOCKER-USER -j "$CHAIN"; done
    if iptables -S "$CHAIN" >/dev/null 2>&1; then iptables -F "$CHAIN"; iptables -X "$CHAIN"; fi
    ;;
  *)
    echo "FALHA: unsupported egress guard action." >&2
    exit 2
    ;;
esac
