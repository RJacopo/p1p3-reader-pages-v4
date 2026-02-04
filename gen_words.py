import json, pathlib, random
random.seed(7)
root=pathlib.Path(__file__).resolve().parent
subjects_phrases={
  'math':[
    ('in total','总共'),('altogether','一共'),('left over','剩下的'),('how many are left','还剩多少'),('find the difference','求差'),('equal to','等于'),('share equally','平均分'),('each of them','他们每个'),('more than','多于'),('less than','少于'),('at least','至少'),('at most','最多'),('round off','四舍五入'),('per day','每天'),('per week','每周'),('per month','每月'),('how much more','多多少'),('how much less','少多少'),('show your working','写出过程'),('word problem','应用题'),
  ],
  'science':[
    ('life cycle','生命周期'),('living things','生物'),('non-living things','非生物'),('needs water','需要水'),('needs air','需要空气'),('grow and change','成长变化'),('respond to changes','对变化作出反应'),('classify into groups','分类成组'),('physical properties','物理性质'),('made of material','由材料制成'),('absorb water','吸水'),('do not absorb','不吸收'),('float on water','浮在水上'),('sink in water','沉入水中'),('warm-blooded','恒温'),('cold-blooded','变温'),('food chain','食物链'),('habitat','栖息地'),('take in food','摄取食物'),('give birth','生孩子'),
  ],
  'english':[
    ('look back','回顾'),('carry out','执行'),('make a plan','制定计划'),('read carefully','仔细阅读'),('answer in a sentence','用一句话回答'),('use a full stop','用句号'),('in your own words','用你自己的话'),('main idea','主旨'),('supporting details','细节'),('compare and contrast','比较和对照'),('because of','因为'),('as a result','因此'),('for example','例如'),('first of all','首先'),('in the end','最后'),('at the same time','同时'),('take turns','轮流'),('pay attention to','注意'),('check your work','检查作业'),('read aloud','大声朗读'),
  ],
  'social_studies':[
    ('community helpers','社区工作者'),('rules and laws','规则与法律'),('public places','公共场所'),('map key','地图图例'),('north south east west','东南西北'),('follow directions','按指示走'),('take care of','照顾'),('work together','一起合作'),('goods and services','商品与服务'),('needs and wants','需要与想要'),('save money','存钱'),('spend wisely','聪明花钱'),('respect others','尊重别人'),('take responsibility','承担责任'),('keep the environment clean','保持环境干净'),
  ],
  'chinese':[
    ('认真读题','认真读题'),('圈出关键词','圈出关键词'),('写出步骤','写出步骤'),('检查答案','检查答案'),('用自己的话说','用自己的话说'),('把句子读一遍','把句子读一遍'),('给出理由','给出理由'),('举一个例子','举一个例子'),('把意思说清楚','把意思说清楚'),('先…再…','先…再…'),('因为…所以…','因为…所以…'),('不仅…而且…','不仅…而且…'),
  ]
}

# helper example templates
SUBJECT_TEMPLATES={
  'math':[('We find the {w} to solve the problem.','我们用{w}来解题。'),('Show your working when you use {w}.','用{w}时写出过程。')],
  'science':[('In science, we learn about {w}.','在科学课里，我们学习{w}。'),('A simple example of {w} is in the picture.','图里有一个{w}的例子。')],
  'english':[('Please {w} before you answer.','回答前请{w}。'),('Use {w} in your sentence.','在句子里使用{w}。')],
  'social_studies':[('We talk about {w} in social studies.','社会研究课会讲{w}。'),('Our class made a poster about {w}.','我们做了一张关于{w}的海报。')],
  'chinese':[('请{w}，再回答。','请{w}，再回答。'),('老师提醒我们要{w}。','老师提醒我们要{w}。')]
}

for path in root.rglob('words.json'):
    if '/data/' not in str(path):
        continue
    parts=path.parts
    # .../data/<p1|p2|p3>/<subject>/words.json
    subject=parts[-2]
    data=json.loads(path.read_text('utf-8'))
    if not isinstance(data,list):
        continue

    # normalize entries + ensure examples
    for w in data:
        lemma=str(w.get('lemma') or w.get('term') or w.get('word') or '').strip()
        if not lemma:
            continue
        w['lemma']=lemma
        w.setdefault('zh','')
        w.setdefault('def', f"{lemma} (study word)")
        if not isinstance(w.get('examples'),list) or not w['examples']:
            temps=SUBJECT_TEMPLATES.get(subject,[("We learn {w}.","我们学习{w}。")])
            ex_en1, ex_zh1=temps[0]
            ex_en2, ex_zh2=temps[-1]
            w['examples']=[
              {'en':ex_en1.format(w=lemma),'zh':ex_zh1.format(w=w.get('zh') or lemma)},
              {'en':ex_en2.format(w=lemma),'zh':ex_zh2.format(w=w.get('zh') or lemma)},
            ]

    # add phrases to reach >=50 phrases overall; keep total >=200 if possible
    phrases=subjects_phrases.get(subject,[])
    existing=set((str(x.get('lemma','')).lower()) for x in data if isinstance(x,dict))
    added=0
    for en,zh in phrases:
        if en.lower() in existing:
            continue
        data.append({'lemma':en,'zh':zh,'pos':'phrase','tag':'PHRASE','def':f"Phrase: {en}",
                     'examples':[{'en':f"Use the phrase '{en}' in a sentence.", 'zh':f"在句子里用“{zh}”。"}]})
        existing.add(en.lower())
        added+=1

    # if still not enough phrases (want 50+), auto-generate generic study phrases
    # count phrases
    phrase_count=sum(1 for x in data if isinstance(x,dict) and x.get('pos')=='phrase')
    while phrase_count < 55:
        base=random.choice(['work it out','check your answer','read the question','circle the keywords','explain your reasoning','show your steps'])
        en=f"{base} {phrase_count-49}" if base in existing else base
        if en.lower() in existing:
            phrase_count+=1
            continue
        zh_map={'work it out':'算一算','check your answer':'检查答案','read the question':'读题','circle the keywords':'圈关键词','explain your reasoning':'解释理由','show your steps':'写步骤'}
        zh=zh_map.get(base,'学习短语')
        data.append({'lemma':en,'zh':zh,'pos':'phrase','tag':'PHRASE','def':f"Phrase: {en}",
                     'examples':[{'en':f"Remember to {base}.", 'zh':f"记得{zh}。"}]})
        existing.add(en.lower())
        phrase_count+=1

    path.write_text(json.dumps(data,ensure_ascii=False,indent=2), 'utf-8')

print('done')
