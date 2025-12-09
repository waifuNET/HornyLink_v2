async function loadHtmlFile(elementId, filePath) {
    const container = document.getElementById(elementId);

    if (!container) {
        console.error(`Ошибка: Элемент с ID "${elementId}" не найден.`);
        return;
    }

    try {
        console.log(`Загрузка контента из: ${filePath}`);
        
        const response = await fetch(filePath);

        if (!response.ok) {
            throw new Error(`Ошибка загрузки ${filePath}: ${response.status} ${response.statusText}`);
        }

        const htmlContent = await response.text();

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;

        container.innerHTML = '';
        while (tempDiv.firstChild) {
            container.appendChild(tempDiv.firstChild);
        }

        const scripts = container.querySelectorAll('script');
        
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');

            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });

            if (oldScript.innerHTML) {
                newScript.innerHTML = oldScript.innerHTML;
            }

            oldScript.parentNode.replaceChild(newScript, oldScript);
            console.log("Скрипт выполнен.");
        });

    } catch (error) {
        console.error("Не удалось загрузить или вставить HTML-файл:", error);
    }
}

window.loadHtmlFile = loadHtmlFile;