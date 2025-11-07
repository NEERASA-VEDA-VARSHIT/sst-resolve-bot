CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_number" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"subcategory" varchar(50),
	"description" text,
	"status" varchar(20) DEFAULT 'open',
	"created_at" timestamp DEFAULT now()
);
