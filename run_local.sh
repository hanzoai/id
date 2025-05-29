#!/bin/bash

# Dừng script nếu có lỗi
set -e

# ==========================
# 🔄 Start Frontend
# ==========================
echo "🚀 Starting Frontend..."
make frontend

# ==========================
# 🔄 Start Backend
# ==========================
echo "🚀 Starting Backend..."
make backend

# ==========================
# 📦 Install Dependencies
# ==========================
echo "📦 Installing Dependencies..."
make deps

# ==========================
# ▶️ Run Application
# ==========================
echo "▶️ Running Application..."
docker run -it -d -p 6379:6379 --name redis redis
make run

echo "🎉 Application is running successfully!"
