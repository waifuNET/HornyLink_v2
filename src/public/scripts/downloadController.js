async function initFooterUpdater() {
    const waitForElements = () => {
        return new Promise((resolve) => {
            const checkElements = () => {
                const footer = document.getElementById('footer');
                const footerDownloadStatus = document.getElementById('footer-download-status');
                const footerText = document.getElementById('footer-text');
                
                if (footer && footerDownloadStatus && footerText) {
                    resolve({ footer, footerDownloadStatus, footerText });
                } else {
                    setTimeout(checkElements, 100);
                }
            };
            checkElements();
        });
    };

    const elements = await waitForElements();
    console.log('Footer элементы найдены');

    async function updateFooterUI() {
        try {
            const progress = await window.electronAPI.games.getCurrentDownloadProgress();
            
            if (!progress) {
                elements.footerDownloadStatus.classList.remove('active');
                elements.footerText.innerHTML = "Нет активных загрузок";
                return;
            }

            const { gameTitle, downloadStatus, progress: progressValue, downloadGamePause } = progress;

            if (downloadStatus) {
                elements.footerDownloadStatus.classList.add('active');
                
                const displayValue = progressValue ? parseFloat(progressValue).toFixed(1) : '0.0';
                if(!downloadGamePause)
                    elements.footerText.innerHTML = `Загрузка: <span class="game-highlight">${gameTitle}</span> : ${displayValue}%`;
                else
                    elements.footerText.innerHTML = `Загрузка приостановлена: <span class="game-highlight">${gameTitle}</span> : ${displayValue}%`;
            } else {
                elements.footerDownloadStatus.classList.remove('active');
                elements.footerText.innerHTML = "Нет активных загрузок";
            }
        } catch (error) {
            console.error('Ошибка обновления footer:', error);
        }
    }

    await updateFooterUI();
    
    const intervalId = setInterval(updateFooterUI, 1000);
    
    window.addEventListener('beforeunload', () => {
        clearInterval(intervalId);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooterUpdater);
} else {
    initFooterUpdater();
}