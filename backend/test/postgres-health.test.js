const test = require( "node:test" ) ;
const assert = require( "node:assert" ) ;
const http = require( "http" ) ;
const express = require( "express" ) ;
const postgres = require( "../src/config/postgres" ) ;

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test" ;

const buildApp = ( ) => {
  const app = express( ) ;
  app.get( "/api/health" , async ( req , res ) => {
    let pgStatus = "unavailable" ;
    try {
      pgStatus = ( await postgres.isPostgresConnected( ) ) ? "connected" : "unavailable" ;
    } catch ( error ) {
      console.error( "Health check: PostgreSQL status error:" , error.message ) ;
    }
    res.status( 200 ) .json( { status: "ok" , service: "temple-billing-backend" , postgres: pgStatus } ) ;
  } ) ;
  return app ;
} ;

const setDbConfig = async ( url = TEST_DB_URL ) => {
  delete process.env.POSTGRES_SSL ;
  delete process.env.PGHOST ;
  delete process.env.PGPORT ;
  delete process.env.PGUSER ;
  delete process.env.PGPASSWORD ;
  delete process.env.PGDATABASE ;
  process.env.DATABASE_URL = url ;
  await postgres.closePostgres( ) ;
} ;

const getHealth = ( app ) => new Promise( ( resolve , reject ) => {
  const server = app.listen( 0 , ( ) => {
    http.get( { host: "127.0.0.1" , port: server.address( ) .port , path: "/api/health" } , ( res ) => {
      let body = "" ;
      res.on( "data" , ( c ) => { body += c ; } ) ;
      res.on( "end" , ( ) => { server.close( ) ; resolve( { statusCode: res.statusCode , body } ) ; } ) ;
    } ) .on( "error" , ( e ) => { server.close( ) ; reject( e ) ; } ) ;
  } ) ;
} ) ;

test( "GET /api/health reports postgres connected when DATABASE_URL is reachable" , async ( ) => {
  await setDbConfig( ) ;
  const app = buildApp( ) ;
  const health = await getHealth( app ) ;
  assert.strictEqual( health.statusCode , 200 ) ;
  const json = JSON.parse( health.body ) ;
  assert.strictEqual( json.postgres , "connected" ) ;
} ) ;

test( "GET /api/health reports postgres unavailable when connection config points nowhere" , async ( ) => {
  const badUrl = "postgresql://nope:nope@127.0.0.1:1/nope" ;
  await setDbConfig( badUrl ) ;
  const app = buildApp( ) ;
  const health = await getHealth( app ) ;
  assert.strictEqual( health.statusCode , 200 ) ;
  const json = JSON.parse( health.body ) ;
  assert.strictEqual( json.postgres , "unavailable" ) ;
} ) ;