#!/bin/sh
# Builds the app and packs the standalone server into deploy.zip for Azure App Service.
# The start command on App Service is: node server.js
set -eu
cd "$(dirname "$0")/.."
rm -rf .next deploy.zip
npm run build
# The standalone server does not include static assets; they go next to it.
cp -R .next/static .next/standalone/.next/static
if [ -d public ] && [ -n "$(ls -A public)" ]; then cp -R public .next/standalone/public; fi
# Env files are read at build time and copied along: keep the keys out of the package.
rm -f .next/standalone/.env*
(cd .next/standalone && zip -qr ../../deploy.zip .)
ls -lh deploy.zip
