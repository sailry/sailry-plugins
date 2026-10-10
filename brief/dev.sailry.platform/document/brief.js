(() => {
  window.MathJax?.loader?.preLoaded('[mathjax-tex]/svg');
  let current = null,generation = 0,serial = 0,zoom = 1,edited = false;
  const sources = new Map(),pending = new Set(),completed = new Set();
  const main = document.getElementById('brief'),toc = document.getElementById('document-toc');
  const dialog = document.getElementById('document-visual'),visual = document.getElementById('document-visual-content');
  const post = event => window.sailryDocumentPost?.(event);

  function theme(value) {
    for (const [key,color] of Object.entries(value)) {
      if (!/^[a-z_]+$/.test(key) || typeof color !== 'string' || color.length > 512) continue;
      document.documentElement.style.setProperty(`--document-${key.replaceAll('_','-')}`,color);
    }
  }

  function structure() {
    toc.replaceChildren();toc.setAttribute('aria-label',current.labels.contents);
    for (const [index,section] of [...main.querySelectorAll('section[data-title]')].entries()) {
      const title = section.dataset.title;section.id = `document-section-${index}`;
      if (!section.querySelector('h1,h2,h3,h4')) {
        const heading = document.createElement('h2');heading.textContent = title;section.prepend(heading);
      }
      const link = document.createElement('a');link.href = `#${section.id}`;link.textContent = title;toc.append(link);
    }
    for (const option of main.querySelectorAll('.compare > .option[data-title]')) {
      if (option.querySelector('h1,h2,h3,h4')) continue;
      const heading = document.createElement('h3');heading.textContent = option.dataset.title;option.prepend(heading);
    }
    for (const table of main.querySelectorAll('table')) {
      const wrapper = document.createElement('div');wrapper.className = 'document-table';table.replaceWith(wrapper);wrapper.append(table);
    }
    for (const form of main.querySelectorAll('form')) {
      for (const control of form.querySelectorAll('input,textarea,select')) {
        if (control.tagName === 'TEXTAREA' || control.tagName === 'INPUT' && control.type === 'text') control.maxLength = 4096;
      }
      for (const button of form.querySelectorAll('button')) {button.type = 'submit';button.textContent = current.labels.submit;}
    }
    writable(current.writable);
  }

  function writable(value) {
    if (current) current.writable = value === true;
    for (const form of main.querySelectorAll('form')) {
      const disabled = value !== true || pending.has(form.dataset.name) || completed.has(form.dataset.name);
      for (const control of form.querySelectorAll('button,input,textarea,select')) control.disabled = disabled;
    }
  }

  async function render() {
    const token = ++generation;
    const palette = current.theme;
    window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,maxTextSize:65536,maxEdges:500,
      theme:'base',themeVariables:{background:palette.background,primaryColor:palette.muted,
        primaryTextColor:palette.foreground,primaryBorderColor:palette.border,lineColor:palette.foreground,
        secondaryColor:palette.secondary,tertiaryColor:palette.accent,edgeLabelBackground:palette.background,
        fontFamily:palette.font_family},flowchart:{htmlLabels:false}});
    for (const [element,source] of sources) {
      if (token !== generation) return;
      try {
        let svg;
        if (element.dataset.kind === 'mermaid') {
          if (source.includes('%%{') || /^\s*---/.test(source) || new TextEncoder().encode(source).length > 65536) throw Error('Unsupported diagram configuration');
          svg = (await window.mermaid.render(`document-diagram-${serial++}`,source)).svg;
        } else if (['math','math-inline'].includes(element.dataset.kind)) {
          if (new TextEncoder().encode(source).length > 65536) throw Error('Formula exceeds the supported size');
          await window.MathJax.startup.promise;
          const formula = await window.MathJax.tex2svgPromise(source,{display:element.dataset.kind === 'math'});
          svg = formula.querySelector('svg').outerHTML;
        } else svg = window.sailryCharts.render(source,palette,Math.max(320,main.clientWidth - 32));
        if (token !== generation) return;
        element.innerHTML = svg;
      } catch (_) {
        if (token !== generation) return;
        const fallback = document.createElement('pre');fallback.textContent = source;element.replaceChildren(fallback);
        post({kind:'render_error',...current.identity});
      }
    }
  }

  async function mount(value) {
    generation++;current = value;edited = false;sources.clear();pending.clear();completed.clear();
    document.title = value.identity.title;theme(value.theme);main.innerHTML = value.html;structure();
    for (const source of main.querySelectorAll('pre.mermaid,pre.chart,pre.math,span.math-inline')) {
      const kind = ['mermaid','chart','math','math-inline'].find(kind => source.classList.contains(kind));
      const element = document.createElement(kind === 'math-inline' ? 'span' : 'div');
      element.className = kind === 'mermaid' ? 'document-diagram' : kind === 'chart' ? 'document-chart' : `document-${kind}`;
      element.dataset.kind = kind;
      sources.set(element,source.textContent);source.replaceWith(element);
    }
    document.getElementById('document-zoom-in').setAttribute('aria-label',value.labels.zoom_in);
    document.getElementById('document-zoom-out').setAttribute('aria-label',value.labels.zoom_out);
    document.getElementById('document-visual-close').setAttribute('aria-label',value.labels.close);
    await render();
  }

  function setZoom(value) {
    zoom = Math.max(.25,Math.min(4,value));
    const svg = visual.querySelector('svg');
    if (svg) svg.style.transform = `scale(${zoom})`;
  }

  document.addEventListener('click',event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (anchor) {event.preventDefault();document.getElementById(anchor.getAttribute('href').slice(1))?.scrollIntoView();return;}
    const diagram = event.target.closest('.document-diagram');
    if (!diagram || !diagram.querySelector('svg') || typeof dialog.showModal !== 'function') return;
    visual.replaceChildren(diagram.querySelector('svg').cloneNode(true));setZoom(1);dialog.showModal();
  });
  document.getElementById('document-zoom-in').addEventListener('click',() => setZoom(zoom * 1.25));
  document.getElementById('document-zoom-out').addEventListener('click',() => setZoom(zoom / 1.25));
  document.getElementById('document-visual-close').addEventListener('click',() => dialog.close());
  function markEdited() {
    if (edited || !current?.writable) return;
    edited = true;post({kind:'edited',...current.identity});
  }
  const edit = event => {if (event.target.closest('form')) markEdited();};
  document.addEventListener('input',edit);document.addEventListener('change',edit);
  document.addEventListener('submit',event => {
    event.preventDefault();
    const form = event.target;
    if (!current?.writable || pending.has(form.dataset.name) || completed.has(form.dataset.name)) return;
    try {
      const result = window.sailryForms.collect(form);
      if (result.missing) {
        result.missing.querySelector('input,textarea,select')?.focus();
        post({kind:'required',...current.identity});return;
      }
      markEdited();
      pending.add(result.form);writable(current.writable);
      post({kind:'submit',...current.identity,...result});
    } catch (_) {post({kind:'invalid_form',...current.identity});}
  });

  async function readonlyExport() {
    const clone = main.cloneNode(true);
    const liveForms = [...main.querySelectorAll('form')];
    for (const [formIndex,form] of [...clone.querySelectorAll('form')].entries()) {
      // cloneNode retains textarea defaults rather than the live value.
      const live = liveForms[formIndex];
      const values = live ? [...live.querySelectorAll('input,textarea,select')] : [];
      for (const [index,control] of [...form.querySelectorAll('input,textarea,select')].entries()) {
        const value = values[index];
        if (!value) continue;
        if (control.tagName === 'SELECT') for (const [index,option] of [...control.options].entries()) option.selected = value.options[index].selected;
        else {control.value = value.value;if (control.tagName === 'INPUT') control.checked = value.checked;}
      }
      form.replaceWith(window.sailryForms.readonly(form));
    }
    return clone.outerHTML;
  }
  window.sailryDocument = {mount,writable,setWritable:writable,readonlyExport,
    async retheme(value) {current.theme = value;theme(value);await render();},
    submitted(form,accepted) {pending.delete(form);if (accepted) completed.add(form);writable(current.writable);}};
})();
