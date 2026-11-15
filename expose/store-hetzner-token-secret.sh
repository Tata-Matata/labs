read -rsp "Hetzner API token: " HETZNER_TOKEN
echo

kubectl create secret generic hetzner \
  --namespace cert-manager \
  --from-literal=token="$HETZNER_TOKEN"

unset HETZNER_TOKEN