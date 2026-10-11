// Tool definitions belong to the ordinary package; sessions and SSH stay native.
export const definitions = {
  ssh_connections:{
    description:"List saved SSH connections available to this session, including IDs and revisions. Passwords, private keys and passphrases are never returned.",
    handler:'connections',operation:'ssh.connections',presentation:'details',
  },
  ssh_save_connection:{
    description:"Create or update an SSH connection under the session permission policy. Create requires name, host, port, username and authentication (agent or key_path); key_path authentication requires the path to an existing key on the execution Node. Update requires connection and expected_revision from ssh_connections, preserving omitted fields and credentials. Never accept passwords, key contents, passphrases or host keys. Use the returned ID for SSH tools in this turn. A first connection requires the user to confirm the exact host fingerprint in the runtime approval; never trust it automatically. Do not automatically repeat a denied or uncertain save.",
    handler:'save',operation:'ssh.save',presentation:'details',
  },
  ssh_run:{
    description:"Run a command on an allowed saved SSH connection after runtime approval. A first connection requires the user to confirm the exact host fingerprint in the runtime approval. Do not request credentials, accept host keys or bypass verification.",
    handler:'run',operation:'ssh.run',presentation:'details',
  },
  ssh_transfer:{
    description:"Upload or download a file using an allowed SSH connection after runtime approval. The local path is relative to the session worktree. Do not request credentials.",
    handler:'transfer',operation:'ssh.transfer',presentation:'details',
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
    properties.timeout_ms={type:'integer',minimum:1,maximum:900000};
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
    authentication:{type:'string',enum:['agent','key_path']},
    key_path:{type:'string',minLength:1,description:'Path to an existing private key on the execution Node; never its contents'},
  },allOf:[{
    if:{required:['connection'],properties:{connection:{type:'string'}}},
    then:{required:['expected_revision'],properties:{expected_revision:{type:'integer'}}},
    else:{required:['name','host','port','username','authentication'],properties:{expected_revision:{type:'null'}},allOf:[{
      if:{properties:{authentication:{const:'key_path'}}},then:{required:['key_path']},
    }]},
  }]};
}
