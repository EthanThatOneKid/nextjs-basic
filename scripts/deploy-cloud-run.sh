#!/usr/bin/env bash
# Deploy the example app to Google Cloud Run, call every route on the live URL, and
# then delete what this script created.
#
#   scripts/deploy-cloud-run.sh --public            deploy, check, delete
#   scripts/deploy-cloud-run.sh --public --keep     deploy, check, leave it running
#
# Needs: gcloud, logged in, with billing on for the project. Docker is not needed:
# Cloud Build builds the image remotely.
#
# Settings (environment variables):
#   PROJECT   Google Cloud project   (default: the active gcloud project)
#   REGION    Cloud Run region       (default: us-central1)
#   SERVICE   Cloud Run service name (default: nextjs-basic-demo)
#   REPO      Artifact Registry repo (default: nextjs-basic)
#
# --public is required because the check calls the service with plain curl, and it
# makes the service reachable by anyone with the URL while it exists. Without --keep
# the service is deleted when the checks finish, whether they pass or fail.
set -euo pipefail

PUBLIC=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --public) PUBLIC=1 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$PUBLIC" -ne 1 ]; then
  echo "Refusing to run without --public." >&2
  echo "The route check calls the service without credentials, so the service must allow" >&2
  echo "unauthenticated requests. It is deleted afterwards unless you pass --keep." >&2
  exit 2
fi

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-nextjs-basic-demo}"
REPO="${REPO:-nextjs-basic}"
[ -n "$PROJECT" ] || { echo "no project: set PROJECT or run gcloud config set project ..." >&2; exit 1; }

IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/example:latest"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BUILT=0
DEPLOYED=0

echo "project: $PROJECT   region: $REGION   service: $SERVICE"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "--keep: leaving service $SERVICE and image $IMAGE in place"
    return
  fi
  echo "cleaning up"
  # only remove what this run created, never something that was already there
  if [ "$DEPLOYED" -eq 1 ]; then
    gcloud run services delete "$SERVICE" --region "$REGION" --project "$PROJECT" --quiet 2>&1 | tail -1 || true
    echo "deleted: Cloud Run service $SERVICE"
  fi
  if [ "$BUILT" -eq 1 ]; then
    gcloud artifacts docker images delete "$IMAGE" --delete-tags --project "$PROJECT" --quiet 2>&1 | tail -1 || true
    echo "deleted: image $IMAGE"
  fi
  echo "left in place: the Artifact Registry repo $REPO, the enabled APIs, and the Cloud Build source bucket"
}
trap cleanup EXIT

if gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" > /dev/null 2>&1; then
  echo "A Cloud Run service named $SERVICE already exists in $PROJECT/$REGION." >&2
  echo "This script deletes its service afterwards, so it will not touch an existing one." >&2
  echo "Pick another name: SERVICE=my-demo scripts/deploy-cloud-run.sh --public" >&2
  exit 1
fi

echo "enabling the APIs this needs (Cloud Run, Cloud Build, Artifact Registry)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" > /dev/null 2>&1; then
  echo "creating the Artifact Registry repo $REPO"
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION" --project "$PROJECT"
fi

echo "building the image with Cloud Build (QB64-PE builds from source; expect several minutes)"
( cd "$HERE" && gcloud builds submit --config deploy/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" --project "$PROJECT" . )
BUILT=1

echo "deploying to Cloud Run"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 1 \
  --quiet
DEPLOYED=1

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format 'value(status.url)')"
echo "live at $URL"

bash "$HERE/scripts/check-routes.sh" "$URL"
echo "PROVED: every example route works on $URL"
