CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_number" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_number" varchar NOT NULL,
	"full_name" varchar,
	"email" varchar,
	"room_number" varchar,
	"mobile" varchar,
	"hostel" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "students_user_number_unique" UNIQUE("user_number")
);
