const en = {
  review_clean: files => `${files} ${files === 1 ? 'file' : 'files'} · No issues`,
  review_issues: findings => `${findings} ${findings === 1 ? 'issue' : 'issues'}`,
};
const zh = {
  review_clean: files => `${files} 个文件 · 无问题`,
  review_issues: findings => `${findings} 个问题`,
};

export function completion(files, findings) {
  const key = findings === 0 ? 'review_clean' : 'review_issues';
  const count = findings === 0 ? files : findings;
  return {label:en[key](count),locales:{'zh-CN':zh[key](count)}};
}
