(() => {
  const bytes = value => new TextEncoder().encode(value).length;
  const name = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);
  const text = (value,limit) => typeof value === 'string' && bytes(value) <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

  function collect(form) {
    const id = form.dataset.name;
    if (!name(id)) throw Error('Invalid form name');
    if ([...form.ownerDocument?.querySelectorAll('form') ?? []]
      .some(item => item !== form && item.dataset.name === id)) throw Error('Duplicate form name');
    const fieldsets = [...form.querySelectorAll('fieldset')],fields = [],seen = new Set();
    if (!fieldsets.length || fieldsets.length > 32) throw Error('Invalid form fields');
    for (const fieldset of fieldsets) {
      const id = fieldset.dataset.name,label = fieldset.querySelector('legend')?.textContent?.trim() ?? '';
      if (!name(id) || seen.has(id) || !text(label,512)) throw Error('Invalid form field');
      seen.add(id);
      const controls = [...fieldset.querySelectorAll('input,textarea,select')];
      if (!controls.length || controls.length > 64 || controls.some(control => control.name !== id || control.disabled)) throw Error('Invalid form controls');
      const values = [];
      for (const control of controls) {
        if (control.tagName === 'INPUT' && ['radio','checkbox'].includes(control.type)) {
          if (!control.checked) continue;
          const label = control.closest('label')?.textContent?.trim() ?? control.value;
          if (!text(control.value,512) || !text(label,512)) throw Error('Invalid form choice');
          values.push({value:control.value,label});
        } else if (control.tagName === 'TEXTAREA' || control.tagName === 'INPUT' && control.type === 'text') {
          if (!text(control.value,4096)) throw Error('Form answer exceeds the supported size');
          if (control.value.trim()) values.push({value:control.value,label:control.value});
        } else if (control.tagName === 'SELECT') {
          for (const option of [...control.selectedOptions]) {
            const label = option.textContent.trim();
            if (!text(option.value,512) || !text(label,512)) throw Error('Invalid form choice');
            if (option.value) values.push({value:option.value,label});
          }
        } else throw Error('Unsupported form control');
      }
      if (fieldset.hasAttribute('data-required') && !values.length) return {missing:fieldset,form:form.dataset.name};
      fields.push({name:id,label,values});
    }
    const result = {form:id,fields};
    if (bytes(JSON.stringify(result)) > 16384) throw Error('Form response exceeds the supported size');
    return result;
  }

  function readonly(form) {
    const output = document.createElement('section');output.className = 'document-readonly';
    for (const fieldset of form.querySelectorAll('fieldset')) {
      const title = document.createElement('h3');title.textContent = fieldset.querySelector('legend')?.textContent ?? '';
      output.append(title);
      const list = document.createElement('ul');
      for (const control of fieldset.querySelectorAll('input,textarea,select')) {
        if (control.tagName === 'INPUT' && ['radio','checkbox'].includes(control.type)) {
          const line = document.createElement('li');line.textContent = `${control.checked ? '☑' : '☐'} ${control.closest('label')?.textContent?.trim() ?? control.value}`;list.append(line);
        } else if (control.tagName === 'SELECT') {
          for (const option of control.options) {
            const line = document.createElement('li');line.textContent = `${option.selected ? '☑' : '☐'} ${option.textContent}`;list.append(line);
          }
        } else {
          const line = document.createElement('li');line.textContent = control.value;list.append(line);
        }
      }
      output.append(list);
    }
    return output;
  }
  window.sailryForms = {collect,readonly};
})();
