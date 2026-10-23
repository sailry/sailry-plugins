// Tool definitions belong to the ordinary package; sessions and SSH stay native.
export const definitions = {
  ssh_connections:{
    description:"List saved SSH connections available to this session, including IDs and revisions. Passwords, private keys and passphrases are never returned.",
    handler:'connections',operation:'ssh.connections',presentation:'summary',
  },
  ssh_save_connection:{
    description:"Create or update an SSH connection under the session permission policy. Create requires name, host, port, username and authentication: password, private_key, key_path or agent. Supply credentials only for the requested save; key paths must be absolute on the execution Node. Update requires connection and expected_revision from ssh_connections. Omitted credentials remain unchanged; a supplied credential replaces them, and an omitted passphrase clears the replacement's passphrase. Do not echo credentials or supply host keys. Use the returned ID for SSH tools in this turn. First use requires runtime host-fingerprint approval. Do not automatically repeat a denied or uncertain save.",
    handler:'save',operation:'ssh.save',presentation:'details',
  },
  ssh_run:{
    description:"Run a command on a saved SSH connection available to this session. Resolve the connection ID with ssh_connections; do not recreate an existing connection when it is unavailable. A first connection requires the user to confirm the exact host fingerprint in the runtime approval. Do not request credentials, accept host keys or bypass verification.",
    handler:'run',result:'completed',operation:'ssh.run',presentation:'details',
  },
  ssh_transfer:{
    description:"Upload or download a file using a saved SSH connection available to this session. Resolve the connection ID with ssh_connections; do not recreate an existing connection when it is unavailable. The local path is relative to the session worktree. Do not request credentials.",
    handler:'transfer',result:'completed',operation:'ssh.transfer',presentation:'details',
  },
};
export function parameters(name,profiles) {
  if (name === 'ssh_connections') return {type:'object',properties:{},required:[],additionalProperties:false};
  if (name === 'ssh_save_connection') return saveParameters();
  const choices = profiles.map(profile=>[profile.id,profile.name]);
  const properties = {connection:{type:'string',pattern:uuid,description:JSON.stringify(choices)}};
  const required = ['connection'];
  if (name === 'ssh_run') {
    properties.command={type:'string'};
    properties.timeout_ms={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
    required.push('command');
  } else {
    properties.path={type:'string'};properties.remote_path={type:'string'};
    properties.direction={type:'string',enum:['upload','download']};
    required.push('path','remote_path','direction');
  }
  return {type:'object',properties,required,additionalProperties:false};
}

const uuid = '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
function saveParameters() {
  return {type:'object',additionalProperties:false,required:[],properties:{
    connection:{type:['string','null'],pattern:uuid,description:'Saved connection ID; omit with expected_revision to create'},
    expected_revision:{type:['integer','null'],minimum:1,maximum:9007199254740991},
    name:{type:'string',minLength:1},host:{type:'string',minLength:1},
    port:{type:'integer',minimum:1,maximum:65535},username:{type:'string',minLength:1},
    authentication:{type:'string',enum:['password','private_key','key_path','agent']},
    credential:{oneOf:[
      {type:'object',properties:{kind:{const:'password'},password:{type:'string'}},required:['kind','password'],additionalProperties:false},
      {type:'object',properties:{kind:{const:'private_key'},key:{type:'string'},passphrase:{type:['string','null']}},required:['kind','key'],additionalProperties:false},
      {type:'object',properties:{kind:{const:'key_path'},path:{type:'string'},passphrase:{type:['string','null']}},required:['kind','path'],additionalProperties:false},
      {type:'object',properties:{kind:{const:'agent'}},required:['kind'],additionalProperties:false},
    ]},
    key_path:{type:'string',minLength:1,description:'Path to an existing private key on the execution Node; never its contents'},
  },allOf:[{
    if:{required:['connection'],properties:{connection:{type:'string'}}},
    then:{required:['expected_revision'],properties:{expected_revision:{type:'integer'}}},
    else:{required:['name','host','port','username','authentication'],properties:{expected_revision:{type:'null'}},allOf:[{
      if:{properties:{authentication:{enum:['password','private_key']}}},then:{required:['credential']},
    },{
      if:{properties:{authentication:{const:'key_path'}}},then:{anyOf:[{required:['credential']},{required:['key_path']}]},
    }]},
  }]};
}
