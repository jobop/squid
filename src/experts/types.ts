export interface Expert {
  id: string;
  name: string;
  role: string;
  expertise: string[];
  promptTemplate: string;
  avatar?: string;
}

export const builtInExperts: Expert[] = [
  {
    id: 'data-analyst',
    name: '数据分析师',
    role: '专业数据分析专家',
    expertise: ['数据清洗', '统计分析', '可视化', 'Python/Pandas'],
    promptTemplate: 'You are a professional data analyst skilled in Python-based data processing and analytics.'
  },
  {
    id: 'content-creator',
    name: '内容创作者',
    role: '专业内容创作专家',
    expertise: ['文案撰写', 'SEO优化', '社交媒体', '品牌传播'],
    promptTemplate: 'You are a professional content creator skilled at writing engaging copy and content.'
  },
  {
    id: 'software-engineer',
    name: '软件工程师',
    role: '全栈开发专家',
    expertise: ['前端开发', '后端开发', '系统架构', '代码审查'],
    promptTemplate: 'You are an experienced software engineer specialized in full-stack development and system design.'
  },
  {
    id: 'product-manager',
    name: '产品经理',
    role: '产品规划专家',
    expertise: ['需求分析', '产品设计', '用户研究', '项目管理'],
    promptTemplate: 'You are a senior product manager specialized in product planning and requirement analysis.'
  },
  {
    id: 'ui-designer',
    name: 'UI 设计师',
    role: '用户界面设计专家',
    expertise: ['界面设计', '交互设计', '视觉设计', '用户体验'],
    promptTemplate: 'You are a professional UI designer specialized in creating intuitive and visually polished interfaces.'
  },
  {
    id: 'devops-engineer',
    name: 'DevOps 工程师',
    role: '运维和自动化专家',
    expertise: ['CI/CD', '容器化', '云服务', '监控告警'],
    promptTemplate: 'You are a DevOps engineer specialized in deployment automation and platform operations.'
  },
  {
    id: 'marketing-specialist',
    name: '营销专家',
    role: '数字营销专家',
    expertise: ['市场策略', '广告投放', '数据分析', '增长黑客'],
    promptTemplate: 'You are a digital marketing specialist skilled in strategy planning and growth execution.'
  },
  {
    id: 'business-analyst',
    name: '商业分析师',
    role: '商业洞察专家',
    expertise: ['商业模式', '竞品分析', '市场研究', '战略规划'],
    promptTemplate: 'You are a business analyst specialized in business model evaluation and strategic planning.'
  }
];
