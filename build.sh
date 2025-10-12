#!/bin/bash
echo "Build başlıyor..."

# Gereksiz bağımlılıkları kaldır, sadece gerekli olanları yükle
pip install -r requirements.txt

echo "Build tamamlandı!"