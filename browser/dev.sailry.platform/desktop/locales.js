// Captions preserve the browser UI from Sailry c4bb60a2.
const en = {
  "browser_address": "Search or enter an address",
  "browser_new_tab": "New tab",
  "browser_empty": "Start browsing",
  "browser_back": "Back",
  "browser_forward": "Forward",
  "browser_reload": "Reload",
  "browser_go": "Open",
  "browser_annotate": "Select element",
  "browser_cancel_selection": "Cancel selection",
  "browser_annotation_unavailable": "Could not select or capture the element",
  "browser_invalid_address": "Invalid address",
  "browser_unavailable": "Browser could not start",
  "browser_load_failed": "Page failed to load",
  "settings_browser": "Browser",
  "close": "Close",
  "browser_data": "Local website data",
  "browser_data_local": "Keep website data",
  "browser_data_description": "Keep website data between uses, or only for this time",
  "browser_chrome_import": "Import from Chrome",
  "browser_chrome_description": "Import website cookies; some sites may need you to sign in again",
  "browser_choose_profile": "Choose a profile",
  "browser_import": "Import",
  "browser_imported": "Imported %{count} cookies, skipped %{skipped}",
  "browser_import_failed": "Cookie import failed",
  "browser_chrome_missing": "No Chrome profiles found",
  "browser_chrome_access_denied": "Chrome data access denied; check Full Disk Access",
  "browser_chrome_failed": "Could not read Chrome data; close Chrome and try again",
  "browser_chrome_schema": "This Chrome data format is not supported",
  "browser_chrome_empty": "This profile has no website cookies",
  "browser_chrome_key_denied": "Could not read the Chrome key; check Keychain access",
  "browser_chrome_cipher": "Could not decrypt this cookie",
  "browser_import_unavailable": "Chrome import is unavailable on this system",
  "browser_store_unavailable": "Keeping website data and importing requires macOS 14 or later",
  "resource_browser_preview": "Browser preview; no pages or network requests are loaded"
};
const zh = {
  "browser_address": "搜索或输入网址",
  "browser_new_tab": "新标签页",
  "browser_empty": "开始浏览",
  "browser_back": "后退",
  "browser_forward": "前进",
  "browser_reload": "刷新",
  "browser_go": "打开",
  "browser_annotate": "选择元素",
  "browser_cancel_selection": "取消选择",
  "browser_annotation_unavailable": "无法选择或截取元素",
  "browser_invalid_address": "网址无效",
  "browser_unavailable": "浏览器无法启动",
  "browser_load_failed": "网页加载失败",
  "resource_browser_preview": "浏览器 UI 预览，未加载网页或访问网络",
  "close": "关闭",
  "settings_browser": "浏览器",
  "browser_data": "本机网站数据",
  "browser_data_local": "保留网站数据",
  "browser_data_description": "开启后保留网站数据；关闭后仅在本次使用期间保留",
  "browser_chrome_import": "从 Chrome 导入",
  "browser_chrome_description": "导入网站 Cookie；部分网站可能需要重新登录",
  "browser_choose_profile": "选择档案",
  "browser_import": "导入",
  "browser_imported": "已导入 %{count} 个 Cookie，跳过 %{skipped} 个",
  "browser_import_failed": "Cookie 导入失败",
  "browser_chrome_missing": "未找到 Chrome 档案",
  "browser_chrome_access_denied": "无法访问 Chrome 数据，请检查“完全磁盘访问”设置",
  "browser_chrome_failed": "无法读取 Chrome 数据，请关闭 Chrome 后重试",
  "browser_chrome_schema": "暂不支持此 Chrome 数据格式",
  "browser_chrome_empty": "此档案没有网站 Cookie",
  "browser_chrome_key_denied": "无法读取 Chrome 密钥，请检查钥匙串授权",
  "browser_chrome_cipher": "无法解密此 Cookie",
  "browser_import_unavailable": "当前系统暂不支持 Chrome 导入",
  "browser_store_unavailable": "保留登录状态和导入需要 macOS 14 或更新版本"
};
const annotation = {
  'zh-TW':['選擇元素','取消選擇','無法選擇或擷取元素'],
  ja:['要素を選択','選択をキャンセル','要素を選択または撮影できませんでした'],
  ko:['요소 선택','선택 취소','요소를 선택하거나 캡처할 수 없습니다'],
  de:['Element auswählen','Auswahl abbrechen','Das Element konnte nicht ausgewählt oder erfasst werden'],
  fr:['Sélectionner un élément','Annuler la sélection','Impossible de sélectionner ou capturer l’élément'],
  es:['Seleccionar elemento','Cancelar selección','No se pudo seleccionar o capturar el elemento'],
  'pt-BR':['Selecionar elemento','Cancelar seleção','Não foi possível selecionar ou capturar o elemento'],
  ru:['Выбрать элемент','Отменить выбор','Не удалось выбрать или снять элемент']
};
export function messages(locale) {
  if (locale === 'zh-CN') return zh;
  const value = annotation[locale];
  return value ? {...en,browser_annotate:value[0],browser_cancel_selection:value[1],browser_annotation_unavailable:value[2]} : en;
}
export function errorKey(error, fallback = 'browser_unavailable') {
  const message = String(error?.message ?? error ?? '');
  return Object.keys(en).find(key => message === key || message.endsWith(': ' + key)) ?? fallback;
}
export function imported(text, count, skipped) {
  return text.browser_imported.replace('%{count}', String(count)).replace('%{skipped}', String(skipped));
}
