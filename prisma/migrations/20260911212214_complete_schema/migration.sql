/*
  Warnings:

  - You are about to drop the column `email` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `examScore` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the `Exam` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `School` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[adminId,admissionNumber]` on the table `Student` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `adminId` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Student` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- DropIndex
DROP INDEX "Student_email_key";

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "email",
DROP COLUMN "examScore",
DROP COLUMN "name",
DROP COLUMN "schoolId",
ADD COLUMN     "adminId" INTEGER NOT NULL,
ADD COLUMN     "admissionNumber" TEXT,
ADD COLUMN     "classId" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "feesAccessGranted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "owingFees" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profileImage" JSONB,
ADD COLUMN     "resultAccessBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resultBlockReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "resultBlockedAt" TIMESTAMP(3),
ADD COLUMN     "resultBlockedBy" INTEGER,
ADD COLUMN     "testResults" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "Exam";

-- DropTable
DROP TABLE "School";

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'superadmin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolCode" TEXT,
    "studentLimit" INTEGER NOT NULL DEFAULT 0,
    "currentStudentCount" INTEGER NOT NULL DEFAULT 0,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteInformation" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL DEFAULT '',
    "shortName" TEXT NOT NULL DEFAULT '',
    "schoolMotto" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "phoneNumber" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "principalName" TEXT NOT NULL DEFAULT '',
    "schoolLogo" JSONB,
    "principalSignature" JSONB,
    "schoolStamp" JSONB,
    "admissionPrefix" TEXT NOT NULL DEFAULT 'SCH',
    "admissionCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInformation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "classLevel" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "qualification" TEXT,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "subjects" INTEGER[],
    "lastLogin" TIMESTAMP(3),
    "lastLoginIP" TEXT NOT NULL DEFAULT '',
    "lastLoginDevice" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "subjects" INTEGER[],
    "students" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resultAccessBlocked" BOOLEAN NOT NULL DEFAULT false,
    "resultBlockReason" TEXT NOT NULL DEFAULT '',
    "resultBlockedAt" TIMESTAMP(3),
    "resultBlockedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "nextTermBegins" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "passMark" INTEGER NOT NULL,
    "instructions" TEXT,
    "questions" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resultsPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT[],
    "correctAnswer" INTEGER NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "explanation" TEXT,
    "teacherId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSet" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSubmission" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT[],
    "correctAnswer" INTEGER NOT NULL,
    "explanation" TEXT,
    "studentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "timesPresent" INTEGER NOT NULL DEFAULT 0,
    "teacherId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuousAssessment" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "testScore" INTEGER NOT NULL DEFAULT 0,
    "noteTakingScore" INTEGER NOT NULL DEFAULT 0,
    "assignmentScore" INTEGER NOT NULL DEFAULT 0,
    "totalCA" INTEGER NOT NULL DEFAULT 0,
    "examScore" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "sourceTestId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuousAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingSystem" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "grades" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTeacherComment" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassTeacherComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherComment" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "effortRating" TEXT NOT NULL DEFAULT '',
    "behaviourRating" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrincipalComment" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "classId" INTEGER,
    "comment" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL DEFAULT 0,
    "classTeacherComment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrincipalComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultAccessSchedule" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "resultStartTime" TIMESTAMP(3) NOT NULL,
    "resultDeadline" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL DEFAULT 'Results are not available at this time. Please check back later.',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultAccessSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolOpenDays" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "timesOpen" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolOpenDays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAssignment" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_username_key" ON "SuperAdmin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_schoolCode_key" ON "Admin"("schoolCode");

-- CreateIndex
CREATE UNIQUE INDEX "SiteInformation_adminId_key" ON "SiteInformation"("adminId");

-- CreateIndex
CREATE INDEX "Subject_adminId_idx" ON "Subject"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_adminId_code_key" ON "Subject"("adminId", "code");

-- CreateIndex
CREATE INDEX "Teacher_adminId_idx" ON "Teacher"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_adminId_email_key" ON "Teacher"("adminId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_adminId_username_key" ON "Teacher"("adminId", "username");

-- CreateIndex
CREATE INDEX "Class_adminId_idx" ON "Class"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_adminId_name_level_section_session_key" ON "Class"("adminId", "name", "level", "section", "session");

-- CreateIndex
CREATE INDEX "Session_adminId_idx" ON "Session"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_adminId_name_key" ON "Session"("adminId", "name");

-- CreateIndex
CREATE INDEX "Term_adminId_idx" ON "Term"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Term_adminId_name_sessionId_key" ON "Term"("adminId", "name", "sessionId");

-- CreateIndex
CREATE INDEX "Test_adminId_classId_subjectId_idx" ON "Test"("adminId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "Test_adminId_idx" ON "Test"("adminId");

-- CreateIndex
CREATE INDEX "Question_adminId_classId_subjectId_idx" ON "Question"("adminId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "Question_adminId_idx" ON "Question"("adminId");

-- CreateIndex
CREATE INDEX "QuestionSet_adminId_classId_subjectId_idx" ON "QuestionSet"("adminId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "QuestionSet_adminId_idx" ON "QuestionSet"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSet_adminId_title_key" ON "QuestionSet"("adminId", "title");

-- CreateIndex
CREATE INDEX "StudentSubmission_adminId_classId_studentId_idx" ON "StudentSubmission"("adminId", "classId", "studentId");

-- CreateIndex
CREATE INDEX "StudentSubmission_adminId_idx" ON "StudentSubmission"("adminId");

-- CreateIndex
CREATE INDEX "Attendance_adminId_idx" ON "Attendance"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_adminId_studentId_classId_term_session_key" ON "Attendance"("adminId", "studentId", "classId", "term", "session");

-- CreateIndex
CREATE INDEX "ContinuousAssessment_adminId_idx" ON "ContinuousAssessment"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ContinuousAssessment_adminId_studentId_classId_subjectId_te_key" ON "ContinuousAssessment"("adminId", "studentId", "classId", "subjectId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "GradingSystem_adminId_idx" ON "GradingSystem"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingSystem_adminId_name_key" ON "GradingSystem"("adminId", "name");

-- CreateIndex
CREATE INDEX "ClassTeacherComment_adminId_idx" ON "ClassTeacherComment"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTeacherComment_adminId_studentId_classId_term_session_key" ON "ClassTeacherComment"("adminId", "studentId", "classId", "term", "session");

-- CreateIndex
CREATE INDEX "TeacherComment_adminId_idx" ON "TeacherComment"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherComment_adminId_studentId_classId_subjectId_termId_s_key" ON "TeacherComment"("adminId", "studentId", "classId", "subjectId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "PrincipalComment_adminId_idx" ON "PrincipalComment"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalComment_adminId_studentId_termId_sessionId_key" ON "PrincipalComment"("adminId", "studentId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "ResultAccessSchedule_adminId_idx" ON "ResultAccessSchedule"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultAccessSchedule_adminId_termId_sessionId_key" ON "ResultAccessSchedule"("adminId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "SchoolOpenDays_adminId_idx" ON "SchoolOpenDays"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolOpenDays_adminId_termId_sessionId_key" ON "SchoolOpenDays"("adminId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "TeacherAssignment_adminId_idx" ON "TeacherAssignment"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAssignment_adminId_teacherId_classId_subjectId_key" ON "TeacherAssignment"("adminId", "teacherId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "Student_adminId_idx" ON "Student"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_adminId_admissionNumber_key" ON "Student"("adminId", "admissionNumber");

-- AddForeignKey
ALTER TABLE "SiteInformation" ADD CONSTRAINT "SiteInformation_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Term" ADD CONSTRAINT "Term_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubmission" ADD CONSTRAINT "StudentSubmission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuousAssessment" ADD CONSTRAINT "ContinuousAssessment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingSystem" ADD CONSTRAINT "GradingSystem_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherComment" ADD CONSTRAINT "ClassTeacherComment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherComment" ADD CONSTRAINT "TeacherComment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalComment" ADD CONSTRAINT "PrincipalComment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAccessSchedule" ADD CONSTRAINT "ResultAccessSchedule_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolOpenDays" ADD CONSTRAINT "SchoolOpenDays_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
