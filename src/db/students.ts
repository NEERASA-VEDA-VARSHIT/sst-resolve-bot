import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  userNumber: varchar("user_number").notNull().unique(),
  fullName: varchar("full_name"),
  email: varchar("email"),
  roomNumber: varchar("room_number"),
  mobile: varchar("mobile"),
  hostel: varchar("hostel"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


