export * from "./students.ts";

// src/db/schema.ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  userNumber: text("user_number").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull(),
  description: text("description"),
  location: text("location"),
  details: text("details"),
  status: text("status").default("open"),
  createdAt: timestamp("created_at").defaultNow(),
});
