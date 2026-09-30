let dialogQueue = Promise.resolve();

function presentDialog({ title, message, inputValue, confirmLabel, cancelLabel }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-mask';
    overlay.innerHTML = `
      <section class="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby="uiDialogTitle" aria-describedby="uiDialogMessage">
        <h2 id="uiDialogTitle"></h2>
        <p id="uiDialogMessage"></p>
        <input class="ui-dialog-input" type="text" aria-label="Message" hidden>
        <div class="ui-dialog-actions"></div>
      </section>`;

    const titleElement = overlay.querySelector('#uiDialogTitle');
    const messageElement = overlay.querySelector('#uiDialogMessage');
    const input = overlay.querySelector('.ui-dialog-input');
    const actions = overlay.querySelector('.ui-dialog-actions');
    const isPrompt = inputValue !== undefined;
    const isConfirm = Boolean(cancelLabel);
    titleElement.textContent = title;
    messageElement.textContent = message;
    input.hidden = !isPrompt;
    if (isPrompt) input.value = inputValue;

    const finish = value => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') finish(isPrompt ? null : isConfirm ? false : true);
      if (event.key === 'Enter' && isPrompt) finish(input.value);
    };
    const confirmButton = document.createElement('button');
    confirmButton.className = 'btn small';
    confirmButton.type = 'button';
    confirmButton.textContent = confirmLabel;
    confirmButton.addEventListener('click', () => finish(isPrompt ? input.value : true));
    actions.appendChild(confirmButton);

    if (isConfirm) {
      const cancelButton = document.createElement('button');
      cancelButton.className = 'btn small ghost';
      cancelButton.type = 'button';
      cancelButton.textContent = cancelLabel;
      cancelButton.addEventListener('click', () => finish(false));
      actions.prepend(cancelButton);
    }

    document.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(isPrompt ? null : isConfirm ? false : true);
    });
    document.body.appendChild(overlay);
    (isPrompt ? input : confirmButton).focus();
  });
}

function enqueueDialog(options) {
  const result = dialogQueue.then(() => presentDialog(options));
  dialogQueue = result.then(() => undefined, () => undefined);
  return result;
}

function showMessage(message, title = 'Notice') {
  return enqueueDialog({ title, message, confirmLabel: 'OK' });
}

function confirmAction(message, title = 'Confirm action') {
  return enqueueDialog({ title, message, confirmLabel: 'Continue', cancelLabel: 'Cancel' });
}

function requestText(message, initialValue = '', title = 'Edit message') {
  return enqueueDialog({ title, message, inputValue: initialValue, confirmLabel: 'Save', cancelLabel: 'Cancel' });
}