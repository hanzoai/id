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
make run

echo "🎉 Application is running successfully!"
