class_name Calculator


func describe(value: int) -> String:
	if value > 0:
		return "positive"
	else:
		return "not positive"


func rank(value: int) -> String:
	match value:
		0:
			return "zero"
		1:
			return "one"
		_:
			return "many"
