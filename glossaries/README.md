# 术语表目录

这里存放专业术语和项目级翻译规范。应用会在每批翻译前自动读取，无需重启。

## CSV / TSV 格式

可直接填写 `terms.csv`，也可以放入多个同结构文件：

| 字段 | 必填 | 说明 |
|---|---|---|
| `source` | 是 | 原语言术语 |
| `target` | 是 | 指定译法 |
| `source_lang` | 否 | `zh` 或 `en` |
| `target_lang` | 否 | `en` 或 `zh` |
| `domain` | 否 | 专业领域 |
| `notes` | 否 | 用法、禁用译法或上下文说明 |

配置了语言方向的术语可以自动反向使用。例如，`zh → en` 的术语在英译中时会自动交换。

## JSON 格式

```json
{
  "terms": [
    {
      "source": "示例术语",
      "target": "example term",
      "source_lang": "zh",
      "target_lang": "en",
      "domain": "示例",
      "notes": "这里仅演示字段"
    }
  ]
}
```

## 风格指南

在 `style_guide.md` 中写语气、标点、日期、大小写等项目规则。当前模板没有实际规则，可以按项目补充。

