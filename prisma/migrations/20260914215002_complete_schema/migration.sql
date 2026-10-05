-- CreateTable
CREATE TABLE "ENoteWeek" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ENoteWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ENoteFile" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "weekId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ENoteFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ENoteWeek_classId_teacherId_idx" ON "ENoteWeek"("classId", "teacherId");

-- CreateIndex
CREATE INDEX "ENoteFile_weekId_idx" ON "ENoteFile"("weekId");

-- AddForeignKey
ALTER TABLE "ENoteWeek" ADD CONSTRAINT "ENoteWeek_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ENoteWeek" ADD CONSTRAINT "ENoteWeek_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ENoteFile" ADD CONSTRAINT "ENoteFile_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ENoteWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
