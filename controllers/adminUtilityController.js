const prisma = require('../config/db');
const { Prisma } = require('@prisma/client');
const { getTenantFilter } = require('../utils/helpers');
const OpenAI = require('openai'); // We can reuse the openai package!

exports.addQuestionSetToTest = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const { testId, questionSetId } = req.body;
        const tenantFilter = getTenantFilter(req);
        
        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: parseInt(testId) } });
        const questionSet = await prisma.questionSet.findFirst({ where: { ...tenantFilter, id: parseInt(questionSetId) } });
        
        if (!test || !questionSet) return res.status(404).json({ success: false, message: 'Test or QuestionSet not found' });

        if (test.classId !== questionSet.classId || test.subjectId !== questionSet.subjectId) {
            return res.status(400).json({ success: false, message: 'QuestionSet is not compatible with this Test.' });
        }

        await prisma.test.update({
            where: { id: test.id },
            data: { questions: questionSet.questions }
        });
        
        res.json({ success: true, message: 'Added questions successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.fixAllTests = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const tenantFilter = getTenantFilter(req);
        
        const testsWithoutQuestions = await prisma.test.findMany({ 
            where: { 
                ...tenantFilter,
                OR: [
                    { questions: { equals: [] } },
                    { questions: { equals: Prisma.JsonNull } },
                    { questions: { equals: Prisma.DbNull } }
                ] 
            }
        });
        
        let fixedCount = 0;
        for (const test of testsWithoutQuestions) {
            const availableQuestions = await prisma.question.findMany({ 
                where: { 
                    ...tenantFilter, 
                    classId: test.classId, 
                    subjectId: test.subjectId 
                },
                take: 10 
            });
            
            if (availableQuestions.length > 0) {
                const questionsJson = availableQuestions.map(q => ({ 
                    questionText: q.questionText, 
                    options: q.options, 
                    correctAnswer: q.correctAnswer, 
                    difficulty: q.difficulty, 
                    explanation: q.explanation 
                }));
                
                await prisma.test.update({
                    where: { id: test.id },
                    data: { questions: questionsJson }
                });
                fixedCount++;
            }
        }
        res.json({ success: true, message: `Fixed ${fixedCount} tests` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.fixTestDates = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const now = new Date();
        const tenantFilter = getTenantFilter(req);
        
        const result = await prisma.test.updateMany({
            where: { 
                ...tenantFilter, 
                isActive: true, 
                startDate: { gt: now } 
            },
            data: { 
                startDate: now 
            }
        });
        
        res.json({ success: true, message: `Updated ${result.count} tests to start today.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.extendAllTests = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const { daysToExtend = 7 } = req.body;
        const now = new Date();
        const tenantFilter = getTenantFilter(req);
        
        const expiredTests = await prisma.test.findMany({ 
            where: { 
                ...tenantFilter, 
                endDate: { lt: now } 
            } 
        });

        const updatePromises = expiredTests.map(test => {
            const newEndDate = new Date(test.endDate);
            newEndDate.setDate(newEndDate.getDate() + daysToExtend);
            
            return prisma.test.update({
                where: { id: test.id },
                data: { endDate: newEndDate }
            });
        });

        await prisma.$transaction(updatePromises);
        
        res.json({ success: true, message: `Extended ${expiredTests.length} tests by ${daysToExtend} days` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// ✅ NEW: BULK QUESTION CONVERTER (Google Gemini AI)
// ===================================================================
// POST /admin/convert-questions
exports.convertQuestions = async (req, res) => {
    try {
        // ✅ FIX: Added 'teacher' to the allowed roles array
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const { rawText } = req.body;
        if (!rawText) return res.status(400).json({ success: false, message: 'Raw text is required.' });

        const OpenAI = require('openai');
        const groq = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1'
        });

        const response = await groq.chat.completions.create({
            // ✅ FIX: Use openai/gpt-oss-120b
            model: 'openai/gpt-oss-120b', 
            messages: [
                {
                    role: 'system',
                    content: 'You are an AI assistant that converts raw text into a JSON array of multiple-choice questions. The output must be an array of objects with the following keys: "questionText" (string), "options" (array of strings), "correctAnswer" (integer index of the correct option, 0-indexed), "difficulty" (string: "easy", "medium", "hard"), "explanation" (string). Only return the valid JSON array, no other text or markdown formatting.'
                },
                {
                    role: 'user',
                    content: `Convert the following text into the specified JSON format:\n\n${rawText}`
                }
            ],
            temperature: 0.1,
        });

        let text = response.choices[0].message.content;
        
        // Clean up markdown if present
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        res.status(200).json({ 
            success: true, 
            data: JSON.parse(text) 
        });
    } catch (error) {
        console.error('Groq Convert Error:', error);
        res.status(500).json({ success: false, message: 'Failed to convert questions.', error: error.message });
    }
};