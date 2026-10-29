/** Shared adapter cases retain snapshot and revision values verbatim. */
export function cases() {
  const target = {kind:'worktree',data:{scope:'all'}};
  const snapshot = {target:{kind:'worktree',data:{scope:'all',head:'c'.repeat(40),
    index_revision:'d'.repeat(64)}},metadata_revision:'a'.repeat(64)};
  const rows = [];
  for (const limit of [501,2001,4000]) {
    rows.push(
      {tool:'git_log',handler:'log',input:{limit},valid:true,
        expected:{worktree:null,limit,cursor:null}},
      {tool:'git_show',handler:'show',input:{path:'src/main.rs',limit},valid:true,
        expected:{worktree:null,revision:'HEAD',path:'src/main.rs',offset:0,limit}},
      {tool:'git_blame',handler:'blame',input:{path:'src/main.rs',limit},valid:true,
        expected:{worktree:null,revision:null,path:'src/main.rs',offset:0,limit}},
      {tool:'list_git_changes',handler:'changes',input:{limit},valid:true,
        expected:{worktree:null,target,cursor:null,limit}},
      {tool:'read_git_change',handler:'change',input:{snapshot,path:'src/main.rs',
        expected_metadata_revision:'b'.repeat(64),limit},valid:true,
        expected:{worktree:null,snapshot,path:'src/main.rs',expected_metadata_revision:'b'.repeat(64),
          expected_revision:null,offset:0,limit}},
    );
  }
  for (const entry of rows.slice(0,5)) {
    for (const limit of [0,-1,1.5,null,'4000',Number.MAX_SAFE_INTEGER+1]) {
      rows.push({...entry,input:{...entry.input,limit},valid:false,schemaValid:limit === Number.MAX_SAFE_INTEGER+1});
    }
  }
  return rows;
}
