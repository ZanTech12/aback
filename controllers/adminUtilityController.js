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

        // ✅ NEW: Pre-process — normalize text
        // 1. Filter out horizontal rule lines (---) that separate questions
        // 2. Strip markdown bold around question numbers: "**1.**" → "1."
        // 3. Normalize single-line options "A. X B. Y" OR "(A) X (B) Y" → multi-line
        const normalizedText = rawText
            .split('\n')
            .filter(line => !/^\s*-{3,}\s*$/.test(line.trim()))   // remove "---" rules
            .map(line => line.replace(/^(\s*)\*+\s*(\d+\.)\s*\*+\s+/, '$1$2 ')) // **1.** → 1.
            .map(line => {
                // Match lines with multiple option markers: "A. ... B. ..." OR "(A) ... (B) ..."
                const optionPattern = /(\(?\b[A-D]\b\)?\.?\s+[^A-D\n]+?)(?=\s+\(?\b[A-D]\b\)?\.?\s+|$)/g;
                const options = line.match(optionPattern);
                if (options && options.length > 1) {
                    return options.map(o => o.trim()).join('\n');
                }
                return line;
            })
            .join('\n');

        // ✅ NEW: Split into chunks of 10 questions to avoid token truncation
        // Handles "1." and "**1.**" (markdown bold) formats — \** matches 0..N asterisks
        const questionBlocks = normalizedText
            .split(/\n(?=\s*\**\s*\d+\.\s*\**\s)/)
            .filter(b => b.trim());

        const CHUNK_SIZE = 10;
        const chunks = [];
        for (let i = 0; i < questionBlocks.length; i += CHUNK_SIZE) {
            chunks.push(questionBlocks.slice(i, i + CHUNK_SIZE).join('\n\n'));
        }

        const SYSTEM_PROMPT = 'You are an AI assistant that converts raw text into a JSON array of multiple-choice questions. The output must be an array of objects with the following keys: "questionText" (string), "options" (array of strings), "correctAnswer" (integer index of the correct option, 0-indexed), "difficulty" (string: "easy", "medium", "hard"), "explanation" (string). You can process up to 40 questions per request. You MUST preserve ALL mathematical symbols, LaTeX notation (e.g. $x^2$, \\frac{a}{b}, \\log_7, \\dots, \\pm, \\times, \\left, \\right), phonetic notation (including slashes like /str/, /skr/), curly quotes (" "), em-dashes, hyphens, currency symbols (e.g. ₦), and any Unicode character EXACTLY as they appear in the source. Do NOT translate, escape, or modify them. The "questionText" should contain the question only (e.g. "Given: 2 + 4 + 6 + ... + 20. Find number of terms."), and "options" must contain the option text only (e.g. "10", "$\\pm 11$") WITHOUT the "(A)"/"A." prefix. If the correct answer is not marked in the source, infer it based on your knowledge. Keep explanations concise (1-2 sentences max). The ENTIRE response must be ONLY a valid JSON array — no markdown fences, no commentary, no preamble. Start with [ and end with ].';

        // ✅ NEW: Process all chunks in parallel, with robust parsing
        const chunkResults = await Promise.all(chunks.map(async (chunk, index) => {
            try {
                const response = await groq.chat.completions.create({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `Convert the following text into the specified JSON format. Preserve all symbols exactly as written:\n\n${chunk}` }
                    ],
                    temperature: 0.1,
                    max_tokens: 4000,
                });

                let text = response.choices[0].message.content || '';
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                const firstBracket = text.indexOf('[');
                const lastBracket = text.lastIndexOf(']');
                if (firstBracket > 0 || lastBracket < text.length - 1) {
                    text = text.substring(firstBracket >= 0 ? firstBracket : 0, lastBracket + 1);
                }

                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed;
                if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
                if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
                return [parsed];
            } catch (chunkError) {
                console.error(`Chunk ${index + 1} failed:`, chunkError.message);
                return [];
            }
        }));

        const allQuestions = chunkResults.flat();

        if (allQuestions.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'AI failed to parse any questions. Please check the input format and try again.'
            });
        }

        res.status(200).json({
            success: true,
            count: allQuestions.length,
            data: allQuestions
        });
    } catch (error) {
        console.error('Groq Convert Error:', error);
        res.status(500).json({ success: false, message: 'Failed to convert questions.', error: error.message });
    }
};
