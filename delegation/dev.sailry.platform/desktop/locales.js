// Existing role settings copy and prompt presets from Sailry ef5e82ea.
import {RESEARCH_INSTRUCTIONS} from './draft.js';
const en = {
  roles_profiles:'Subagents',role_editor:'Edit subagent',role_id:'Identifier',settings_name:'Name',settings_empty:'No items',
  role_model_source:'Model source',role_fixed:'Fixed model',role_inherit:'Inherit session model',
  provider_models:'Models',provider_default_effort:'Default reasoning effort',role_max_turns:'Default maximum turns',
  role_instructions:'Instructions',role_read_only:'Read only',role_appearance:'Icon and color',role_presets:'Presets',
  role_preset_review:'Code review',role_preset_research:'Research',role_preset_implement:'Implementation',
  role_prompt_review:'Review code and changes within the assigned scope, focusing on correctness, edge cases, regression risks and existing conventions.\nRead relevant implementations and tests first, then report evidence-backed findings with locations, impact and recommendations. Do not modify files unless asked; state plainly when no issues are found.',
  role_prompt_research:RESEARCH_INSTRUCTIONS,
  role_add_research:'Add research',role_research_description:'Investigate public sources',
  role_prompt_implement:'Complete the assigned implementation, first understanding the existing architecture, coding conventions and acceptance requirements.\nReuse existing capabilities, keep changes focused and verify affected behavior. Report what was completed, actual checks and remaining limitations.',
  role_invalid:'Check the identifier, name and turn limit',role_conflict:'Subagent changed; reopen it',
  role_duplicate:'Identifier already exists',role_model_unavailable:'Selected model or provider is unavailable',
  role_effort_inherit:'Auto',role_effort_invalid:'Model does not support this reasoning effort',
  role_skill_unavailable:'Skill is unavailable',role_remove_live:'Remove subagent “%{name}”? Submitted tasks are unaffected',
  role_save:'Save',role_retry:'Retry',role_disconnected:'Disconnected',
  role_unknown:'Result unconfirmed; retry the original request',role_failed:'Operation failed; retry',
  role_capacity:'Subagent limit reached',settings_add:'Add',settings_edit:'Edit',settings_delete:'Delete',settings_cancel:'Cancel',
  media_unconfigured:'Not configured',form_role_id_hint:'e.g. code-reviewer',form_name_hint:'Enter a name',
  form_turns_hint:'Leave blank for no limit',form_role_instructions_hint:'Enter instructions',
  effort_dynamic:'dynamic',effort_budget:'%{tokens} Token'
};
const zh = {
  roles_profiles:'子代理',role_editor:'编辑子代理',role_id:'标识',settings_name:'名称',settings_empty:'暂无内容',
  role_model_source:'模型来源',role_fixed:'固定模型',role_inherit:'继承会话模型',
  provider_models:'模型',provider_default_effort:'默认推理强度',role_max_turns:'默认最大轮数',
  role_instructions:'提示词',role_read_only:'只读',role_appearance:'图标和颜色',role_presets:'预设',
  role_preset_review:'代码审查',role_preset_research:'调查分析',role_preset_implement:'开发实现',
  role_prompt_review:'审查指定范围内的代码和变更，重点检查正确性、边界条件、回归风险和现有规范。\n先阅读相关实现与测试，再报告有证据支持的问题，注明位置、影响和建议。不要自行修改文件；没有发现问题时如实说明。',
  role_prompt_research:RESEARCH_INSTRUCTIONS,
  role_add_research:'添加研究代理',role_research_description:'研究公开资料',
  role_prompt_implement:'完成交付范围内的实现，先理解现有架构、代码规范和验收要求。\n复用已有能力，保持改动聚焦，验证受影响的行为。报告实际完成的内容、检查结果和仍存在的限制。',
  role_invalid:'请检查标识、名称和轮数',role_conflict:'子代理已变更，请重新打开',
  role_duplicate:'标识已存在',role_model_unavailable:'所选模型或供应商不可用',
  role_effort_inherit:'自动',role_effort_invalid:'模型不支持此推理强度',role_skill_unavailable:'技能不可用',
  role_remove_live:'移除子代理“%{name}”？已发送任务不受影响',role_save:'保存',role_retry:'重试',
  role_disconnected:'未连接',role_unknown:'结果未确认，请重试原请求',role_failed:'操作失败，请重试',
  role_capacity:'子代理数量已达上限',settings_add:'添加',settings_edit:'编辑',settings_delete:'删除',settings_cancel:'取消',
  media_unconfigured:'未配置',form_role_id_hint:'如 code-reviewer',form_name_hint:'输入名称',
  form_turns_hint:'留空不限制',form_role_instructions_hint:'填写提示词',effort_dynamic:'dynamic',effort_budget:'%{tokens} Token'
};
const readOnly = {
  de:'Nur lesen',es:'Solo lectura',fr:'Lecture seule',ja:'読み取り専用',ko:'읽기 전용',
  'pt-BR':'Somente leitura',ru:'Только чтение','zh-TW':'唯讀'
};
const research = {
  de:{role_preset_research:'Recherche',role_add_research:'Recherche hinzufügen',role_research_description:'Öffentliche Quellen untersuchen'},
  es:{role_preset_research:'Investigación',role_add_research:'Añadir investigación',role_research_description:'Investigar fuentes públicas'},
  fr:{role_preset_research:'Recherche',role_add_research:'Ajouter une recherche',role_research_description:'Étudier les sources publiques'},
  ja:{role_preset_research:'調査',role_add_research:'調査エージェントを追加',role_research_description:'公開情報を調査'},
  ko:{role_preset_research:'조사',role_add_research:'조사 에이전트 추가',role_research_description:'공개 자료 조사'},
  'pt-BR':{role_preset_research:'Pesquisa',role_add_research:'Adicionar pesquisa',role_research_description:'Investigar fontes públicas'},
  ru:{role_preset_research:'Исследование',role_add_research:'Добавить исследование',role_research_description:'Изучать открытые источники'},
  'zh-TW':{role_preset_research:'研究',role_add_research:'新增研究代理',role_research_description:'研究公開資料'}
};
export function messages(locale) {
  return {...en,...(locale === 'zh-CN' ? zh : {}),...(readOnly[locale] ? {role_read_only:readOnly[locale]} : {}),...(research[locale] ?? {})};
}
