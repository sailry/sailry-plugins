export function messages(locale) {
  return locale === 'zh-CN' ? {
    empty:'暂无目标', hint:'描述结果及验证方式', evidence:'完成依据', earlier:'历史目标',
    turns:'轮次', time:'用时', tokens:'Token',
    completed:'已完成', cleared:'已清除', replaced:'已替换',
    pause:'暂停', resume:'继续', edit:'编辑', clear:'清除', reopen:'重新打开', save:'保存', cancel:'取消', retry:'重试',
    paused:'目标已暂停', resumed:'目标已继续', edited:'目标已更新', removed:'目标已清除',
    error:'目标操作失败', uncertain:'结果未确认，请重试', readFailed:'无法读取目标',
  } : {
    empty:'No goal', hint:'Describe the outcome and how to check it', evidence:'Evidence', earlier:'Earlier goals',
    turns:'Turns', time:'Time', tokens:'Tokens',
    completed:'Completed', cleared:'Cleared', replaced:'Replaced',
    pause:'Pause', resume:'Resume', edit:'Edit', clear:'Clear', reopen:'Reopen', save:'Save', cancel:'Cancel', retry:'Retry',
    paused:'Goal paused', resumed:'Goal resumed', edited:'Goal updated', removed:'Goal cleared',
    error:'Goal action failed', uncertain:'Outcome unconfirmed, retry', readFailed:'Could not read the goal',
  };
}
