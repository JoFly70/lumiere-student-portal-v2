import { type User, type InsertUser } from "@shared/schema";
import { randomUUID } from "crypto";

// NOTE: This storage interface is deprecated and will be replaced
// by Supabase-backed services. Currently kept for backward compatibility.

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const createdAt = new Date();
    const user: User = { 
      ...insertUser, 
      id,
      role: insertUser.role || 'student',
      createdAt 
    };
    this.users.set(id, user);
    return user;
  }
}

export const storage = new MemStorage();
