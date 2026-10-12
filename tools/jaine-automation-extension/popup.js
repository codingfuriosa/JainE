document.getElementById('run').addEventListener('click', () => {
  const result = document.getElementById('result');
  result.textContent = 'Running...';
  chrome.runtime.sendMessage({ type: 'run-now' }, (response) => {
    if (chrome.runtime.lastError) {
      result.textContent = 'Error: ' + chrome.runtime.lastError.message;
      return;
    }
    result.textContent = response.ok ? response.summary : 'Error: ' + response.error;
  });
});
