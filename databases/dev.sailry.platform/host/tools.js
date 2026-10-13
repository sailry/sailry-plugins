// Tool definitions and SQL presentation policy belong to the ordinary package.
export const definitions = {
  database_connections:{
    description:"List saved database connections available to this session, including IDs, revisions, engines and whether credentials are required. No passwords are returned.",
    handler:"connections",operation:"databases.connections",presentation:"details",
  },
  database_save_connection:{
    description:"Create or update a database connection under the session permission policy. Create requires name and engine, plus path for SQLite or host, port, username and database for MySQL/PostgreSQL. If database_connections returns no profiles, create without connection or expected_revision; do not reuse an ID from earlier conversation history. Saving records configuration only and does not create a SQLite file. New connections default to read_only=true; use read_only=false only for requested writes. Update requires connection and expected_revision from database_connections and preserves omitted fields and credentials. Never accept or request passwords; when credentials_required is true, the user supplies them in protected settings. Use the returned ID directly for catalog or SQL tools in this turn. Do not automatically repeat a denied or uncertain save.",
    handler:"save",operation:"databases.save",presentation:"details",
  },
  database_catalog:{
    description:"List databases, or tables in a selected database, using a saved connection. Credentials remain on the execution Node.",
    handler:"catalog",operation:"databases.catalog",presentation:"details",
  },
  database_query:{
    description:"Run one read-only SQL statement without approval. The execution connection is forced read-only. Use this for SELECT, inspecting schema, and analysis. Results also appear in the database workspace. Use database_execute for writes; never try to disable read-only protection.",
    handler:"query",operation:"databases.query",presentation:"content",
  },
  database_execute:{
    description:"Execute one SQL write statement under the session permission policy. Use for INSERT, UPDATE, DELETE, and schema changes. For a missing writable SQLite file, an authorized schema write initializes it and creates missing parent directories; do not create the folder or an empty file separately. Explicit writable connection checks can also initialize a missing file. Reads, catalog, read-only connection checks, and PRAGMAs do not initialize a file. The saved connection's read-only setting still applies. Invoke this tool directly instead of asking for approval in chat. Do not retry a denied or uncertain write automatically.",
    handler:"execute",operation:"databases.execute",presentation:"details",
  },
};

export function label(profile) {
  const engine = {sqlite:'SQLite',mysql:'MySQL',postgres:'PostgreSQL'}[profile.engine];
  const quoting = profile.engine === 'mysql'
    ? 'backtick-quoted identifiers; do not use double quotes for table or database names'
    : profile.engine === 'postgres'
      ? 'double-quoted identifiers; qualify tables with schema, not database'
      : 'double-quoted identifiers';
  return `${profile.name}; engine=${engine}; default_database=${profile.database}; read_only=${profile.read_only}; ${quoting}`;
}

export function parameters(name,profiles) {
  if (name === 'database_connections') return {type:'object',properties:{},required:[],additionalProperties:false};
  if (name === 'database_save_connection') return saveParameters();
  const choices = profiles.map(profile=>[profile.id,label(profile)]);
  const properties = {connection:{type:'string',pattern:uuid,description:JSON.stringify(choices)},
    database:{type:'string',description:'Database name; omit to use the saved default'}};
  const required = ['connection'];
  if (name !== 'database_catalog') { properties.sql={type:'string'};required.push('sql'); }
  return {type:'object',properties,required,additionalProperties:false};
}

const uuid = '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
function saveParameters() {
  return {type:'object',additionalProperties:false,required:[],properties:{
    connection:{type:['string','null'],pattern:uuid,description:'Saved connection ID; omit with expected_revision to create'},
    expected_revision:{type:['integer','null'],minimum:1,maximum:9007199254740991},
    name:{type:'string',minLength:1},engine:{type:'string',enum:['sqlite','mysql','postgres']},
    path:{type:'string',minLength:1,description:'SQLite file path on the execution Node; relative paths use the captured worktree. Saving does not create the file'},
    host:{type:'string',minLength:1},port:{type:'integer',minimum:1,maximum:65535},
    username:{type:'string',minLength:1},database:{type:'string'},read_only:{type:'boolean'},
  },allOf:[{
    if:{required:['connection'],properties:{connection:{type:'string'}}},
    then:{required:['expected_revision'],properties:{expected_revision:{type:'integer'}}},
    else:{required:['name','engine'],properties:{expected_revision:{type:'null'}},allOf:[{
      if:{properties:{engine:{const:'sqlite'}}},then:{required:['path']},
      else:{required:['host','port','username','database']},
    }]},
  }]};
}
