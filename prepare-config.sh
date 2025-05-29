#!/bin/bash

SOURCE_FILE="conf/app_dev.conf"
TARGET_FILE="conf/app.conf"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "❌ File $SOURCE_FILE not exist."
  exit 1
fi

mkdir -p conf

cp -f "$SOURCE_FILE" "$TARGET_FILE"

echo "✅ copy $SOURCE_FILE to $TARGET_FILE."
