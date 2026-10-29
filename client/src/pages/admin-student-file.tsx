/** S27 Student file page (/admin/students/:studentId). All of the work lives in components/admin/file/student-file. */
import React from "react";
import { useParams } from "wouter";
import { StudentFile } from "@/components/admin/file/student-file";

export default function AdminStudentFile() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  return <StudentFile studentId={studentId} />;
}
