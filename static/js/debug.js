// static/js/debug.js
console.log("🔧 Debug.js yüklendi - Tekel POS Sistemi");

// Sistem bilgilerini göster
function showSystemInfo() {
    console.log("🖥️ Sistem Bilgisi:");
    console.log("User Agent:", navigator.userAgent);
    console.log("Platform:", navigator.platform);
    console.log("Dil:", navigator.language);
    console.log("Çerezler:", navigator.cookieEnabled);
    console.log("JavaScript:", "Aktif");
    console.log("Online:", navigator.onLine);
}

// Kamera desteğini kontrol et
function checkCameraSupport() {
    console.log("📷 Kamera Desteği:");
    console.log("MediaDevices:", !!navigator.mediaDevices);
    console.log("getUserMedia:", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
    console.log("HTTPS:", window.location.protocol === 'https:');
    
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const cameras = devices.filter(device => device.kind === 'videoinput');
                console.log("Mevcut Kameralar:", cameras.length);
            })
            .catch(err => console.error("Cihaz listeleme hatası:", err));
    }
}

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 Tekel POS Sistemi Başlatıldı");
    showSystemInfo();
    checkCameraSupport();
});