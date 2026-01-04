import { Context } from "invoket/context";

// Typed interfaces for task parameters
interface SearchParams {
  query: string;
  limit?: number;
  offset?: number;
}

interface UserData {
  name: string;
  email: string;
  age?: number;
}

// Namespace classes
class DbNamespace {
  /** Run database migrations */
  async migrate(c: Context, direction: string = "up") {
    console.log(`Migrating database: ${direction}`);
  }

  /** Seed the database */
  async seed(c: Context) {
    console.log("Seeding database...");
  }

  /** Private helper - should not be callable */
  async _helper(c: Context) {
    console.log("This should not be callable");
  }
}

class InternalNamespace {
  /** Secret internal task */
  async secret(c: Context) {
    console.log("Secret!");
  }
}

/**
 * Example tasks for testing the invoket CLI
 */
export class Tasks {
  db = new DbNamespace();
  _internal = new InternalNamespace(); // Private namespace
  /**
   * Say hello with a name and repeat count
   * @flag name -n
   * @flag count -c
   */
  async hello(c: Context, name: string, count: number) {
    for (let i = 0; i < count; i++) {
      console.log(`Hello, ${name}! (${i + 1}/${count})`);
    }
  }

  /** Greet someone with optional enthusiasm */
  async greet(c: Context, name: string, enthusiasm: number = 1) {
    const bangs = "!".repeat(enthusiasm);
    console.log(`Greetings, ${name}${bangs}`);
  }

  /** Search with JSON parameters */
  async search(c: Context, entity: string, params: SearchParams) {
    console.log(`Searching ${entity}:`);
    console.log(`  query: "${params.query}"`);
    console.log(`  limit: ${params.limit ?? 10}`);
    console.log(`  offset: ${params.offset ?? 0}`);
  }

  /** Create a user from JSON data */
  async createUser(c: Context, data: UserData) {
    console.log("Creating user:");
    console.log(`  name: ${data.name}`);
    console.log(`  email: ${data.email}`);
    if (data.age !== undefined) {
      console.log(`  age: ${data.age}`);
    }
  }

  /** Process multiple items */
  async batch(c: Context, items: string[]) {
    console.log(`Processing ${items.length} items:`);
    for (const item of items) {
      console.log(`  - ${item}`);
    }
  }

  /** Install packages (rest params) */
  async install(c: Context, ...packages: string[]) {
    console.log(`Installing ${packages.length} packages:`);
    for (const pkg of packages) {
      console.log(`  - ${pkg}`);
    }
  }
}
