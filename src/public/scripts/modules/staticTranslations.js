(function() {
    'use strict';

    if (!window.electronAPI || typeof window.electronAPI.language.getLanguageMessage !== 'function') {
        console.error("i18n Module Error: window.electronAPI.language.getLanguageMessage is not defined. Internationalization will not work.");
        return;
    }

    async function processElement(element) {
        const i18nAttr = element.getAttribute('data-i18n');
        if (!i18nAttr) return;

        try {
            const parts = i18nAttr.split('.');
            let key, namespace;

            if (parts.length > 1) {
                namespace = parts[0];
                key = parts.slice(1).join('.');
            } else {
                key = i18nAttr;
                namespace = element.dataset.i18nNamespace || 'ui';
            }

            const translatedText = await window.electronAPI.language.getLanguageMessage(key, namespace);

            if (element.tagName === 'TITLE') {
                document.title = translatedText;
            } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                if (element.placeholder !== undefined) {
                    element.placeholder = translatedText;
                } else {
                    element.value = translatedText;
                }
            } else {
                element.textContent = translatedText;
            }

        } catch (error) {
            console.warn(`i18n Module: Failed to translate element with data-i18n="${i18nAttr}".`, error);
        }
    }

    function findAndProcessElements(root) {
        const elements = root.querySelectorAll('[data-i18n]');
        elements.forEach(processElement);
    }

    let observer = null;
    const observerConfig = { childList: true, subtree: true };

    function startObserver() {
        if (observer) return;

        observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            if (node.hasAttribute && node.hasAttribute('data-i18n')) {
                                processElement(node);
                            }
                            findAndProcessElements(node);
                        }
                    });
                }
            }
        });

        if (document.body) {
            observer.observe(document.body, observerConfig);
        }
    }

    window.i18nReload = function() {
        console.log("[i18n] Reloading translations...");
        findAndProcessElements(document);

        if (!observer) startObserver();
    };

    window.t = async function(i18nKey) {
    if (!i18nKey || typeof i18nKey !== 'string') return '';

        try {
            const parts = i18nKey.split('.');
            let key, namespace;

            if (parts.length > 1) {
                namespace = parts[0];
                key = parts.slice(1).join('.');
            } else {
                namespace = 'ui';
                key = i18nKey;
            }

            const result = await window.electronAPI.language.getLanguageMessage(key, namespace);
            return result;

        } catch (err) {
            console.error(`[i18n] Failed to resolve key "${i18nKey}"`, err);
            return i18nKey;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        findAndProcessElements(document);
        startObserver();
    });

    if (document.readyState === 'complete') {
        findAndProcessElements(document);
        startObserver();
    }
})();
