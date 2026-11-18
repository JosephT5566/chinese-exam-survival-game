#!/usr/bin/env bash
# Run once with a project administrator; reruns reconcile the same resources.
set -euo pipefail
project='chinese-exam-survival-game'
project_number='355829324177'
pool='github-hosting'
provider='hosting-deploy'
account='github-hosting-deploy'
email="${account}@${project}.iam.gserviceaccount.com"
condition="assertion.repository_id == '1462402134' && assertion.repository_owner_id == '30860126' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'JosephT5566/chinese-exam-survival-game/.github/workflows/ci.yml@refs/heads/main' && assertion.event_name in ['push', 'workflow_dispatch']"
mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'

# No billing activation and no service-account key creation.
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project"
if ! gcloud iam service-accounts describe "$email" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$account" --display-name='GitHub Hosting deploy' --project="$project"
fi
if ! gcloud iam workload-identity-pools describe "$pool" --location=global --project="$project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --location=global --display-name='GitHub Hosting' --project="$project"
fi
if gcloud iam workload-identity-pools providers describe "$provider" --workload-identity-pool="$pool" --location=global --project="$project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$provider" \
    --workload-identity-pool="$pool" --location=global --project="$project" \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping="$mapping" --attribute-condition="$condition"
else
  gcloud iam workload-identity-pools providers create-oidc "$provider" \
    --workload-identity-pool="$pool" --location=global --project="$project" \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping="$mapping" --attribute-condition="$condition"
fi
gcloud projects add-iam-policy-binding "$project" \
  --member="serviceAccount:${email}" --role='roles/firebasehosting.admin' --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$email" --project="$project" \
  --member="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${pool}/attribute.repository_id/1462402134" \
  --role='roles/iam.workloadIdentityUser' --quiet >/dev/null
printf 'Configured provider: projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$project_number" "$pool" "$provider"
