import {
  Condition,
  ValueQuery,
  DateLiteral,
  DateNLiteral,
  FieldFunctionExpression,
  FieldRelationship,
  FieldSubquery,
  FieldType,
  FieldTypeOf,
  FieldTypeOfCondition,
  FunctionExp,
  GroupByClause,
  HavingClause,
  LiteralType,
  LogicalPrefix,
  NullsOrder,
  OrderByClause,
  OrderByCriterion,
  Query,
  Subquery,
  WhereClause,
  WithDataCategoryCondition,
  Field,
} from '../api/api-models';
import {
  ApexBindVariableExpressionContext,
  ArrayExpressionWithType,
  AtomicExpressionContext,
  BooleanContext,
  ConditionExpressionContext,
  DateNLiteralContext,
  ExpressionContext,
  ExpressionOperatorContext,
  ExpressionTree,
  FieldFunctionContext,
  FromClauseContext,
  FunctionExpressionContext,
  GroupByClauseContext,
  HavingClauseContext,
  LiteralTypeWithSubquery,
  OperatorContext,
  OrderByClauseContext,
  OrderByExpressionContext,
  OrderByFunctionExpressionContext,
  SelectClauseContext,
  SelectClauseFunctionIdentifierContext,
  SelectClauseSubqueryIdentifierContext,
  SelectClauseTypeOfContext,
  SelectClauseTypeOfElseContext,
  SelectClauseTypeOfThenContext,
  SelectStatementContext,
  usingScopeClauseContext,
  ValueContext,
  WhereClauseContext,
  WhereClauseSubqueryContext,
  WithClauseContext,
  WithDateCategoryContext,
  LocationFunctionContext,
  GeoLocationFunctionContext,
  OrderByLocationExpressionContext,
  GroupByFieldListContext,
  SelectClauseIdentifierContext,
} from '../models';
import { isSubqueryFromFlag, isToken } from '../utils';
import { parse, ParseQueryConfig, SoqlParser } from './parser';
import { isString, isNull } from 'util';
import { IToken } from 'chevrotain';

const parser = new SoqlParser();

const BaseSoqlVisitor = parser.getBaseCstVisitorConstructor();

const BOOLEANS = ['TRUE', 'FALSE'];
const DATE_LITERALS: DateLiteral[] = [
  'YESTERDAY',
  'TODAY',
  'TOMORROW',
  'LAST_WEEK',
  'THIS_WEEK',
  'NEXT_WEEK',
  'LAST_MONTH',
  'THIS_MONTH',
  'NEXT_MONTH',
  'LAST_90_DAYS',
  'NEXT_90_DAYS',
  'THIS_QUARTER',
  'LAST_QUARTER',
  'NEXT_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
  'NEXT_YEAR',
  'THIS_FISCAL_QUARTER',
  'LAST_FISCAL_QUARTER',
  'NEXT_FISCAL_QUARTER',
  'THIS_FISCAL_YEAR',
  'LAST_FISCAL_YEAR',
  'NEXT_FISCAL_YEAR',
];

const DATE_N_LITERALS: DateNLiteral[] = [
  'NEXT_N_DAYS',
  'LAST_N_DAYS',
  'N_DAYS_AGO',
  'NEXT_N_WEEKS',
  'LAST_N_WEEKS',
  'N_WEEKS_AGO',
  'NEXT_N_MONTHS',
  'LAST_N_MONTHS',
  'N_MONTHS_AGO',
  'NEXT_N_QUARTERS',
  'LAST_N_QUARTERS',
  'N_QUARTERS_AGO',
  'NEXT_N_YEARS',
  'LAST_N_YEARS',
  'N_YEARS_AGO',
  'NEXT_N_FISCAL_QUARTERS',
  'LAST_N_FISCAL_QUARTERS',
  'N_FISCAL_QUARTERS_AGO',
  'NEXT_N_FISCAL_YEARS',
  'LAST_N_FISCAL_YEARS',
  'N_FISCAL_YEARS_AGO',
];

class SOQLVisitor extends BaseSoqlVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  /**
   * This is the only public entry point for the parser
   * @param ctx
   * @param options
   */
  selectStatement(ctx: SelectStatementContext, options?: { isSubquery: boolean }): Query | Subquery {
    const { isSubquery } = options || { isSubquery: false };
    const output: Partial<Query | Subquery> = {};

    output.fields = this.visit(ctx.selectClause);

    if (isSubqueryFromFlag(output, isSubquery)) {
      const { sObject, alias, sObjectPrefix } = this.visit(ctx.fromClause);
      output.relationshipName = sObject;
      if (alias) {
        output.sObjectAlias = alias;
      }
      if (sObjectPrefix) {
        output.sObjectPrefix = sObjectPrefix;
      }
    } else {
      const { sObject, alias } = this.visit(ctx.fromClause);
      (output as Query).sObject = sObject;
      if (alias) {
        output.sObjectAlias = alias;
      }
    }

    if (!!output.sObjectAlias) {
      output.fields.forEach((field: any) => {
        if (field.relationships && field.relationships[0] === output.sObjectAlias) {
          field.relationships = field.relationships.slice(1);
          field.objectPrefix = output.sObjectAlias;
        }
        if (field.relationships && field.relationships.length === 0) {
          delete field.relationships;
          field.type = 'Field';
        }
      });
    }

    if (ctx.usingScopeClause) {
      output.usingScope = this.visit(ctx.usingScopeClause);
    }

    if (ctx.whereClause) {
      output.where = this.visit(ctx.whereClause);
    }

    if (ctx.withClause) {
      ctx.withClause.forEach((item: any) => {
        const { withSecurityEnforced, withDataCategory } = this.visit(item);
        if (withSecurityEnforced) {
          output.withSecurityEnforced = withSecurityEnforced;
        }
        if (withDataCategory) {
          output.withDataCategory = withDataCategory;
        }
      });
    }

    if (ctx.groupByClause) {
      output.groupBy = this.visit(ctx.groupByClause);
    }

    if (ctx.orderByClause) {
      output.orderBy = this.visit(ctx.orderByClause);
    }

    if (ctx.limitClause) {
      output.limit = Number(this.visit(ctx.limitClause));
    }

    if (ctx.offsetClause) {
      output.offset = Number(this.visit(ctx.offsetClause));
    }

    if (ctx.forViewOrReference) {
      output.for = this.visit(ctx.forViewOrReference);
    }

    if (ctx.updateTrackingViewstat) {
      output.update = this.visit(ctx.updateTrackingViewstat);
    }

    return output as Query | Subquery;
  }

  selectClause(ctx: SelectClauseContext): string[] {
    if (ctx.field) {
      return ctx.field.map(item => {
        if (isToken(item)) {
          const field: string = item.image;
          let output: FieldType;
          if (!field.includes('.')) {
            output = {
              type: 'Field',
              field: field,
              // objectPrefix: undefined, // TODO: we cannot add this until the very und when we see if the sobject is aliased
            };
          } else {
            const splitFields = field.split('.');
            output = {
              type: 'FieldRelationship',
              field: splitFields[splitFields.length - 1],
              relationships: splitFields.slice(0, splitFields.length - 1),
              // objectPrefix: undefined, // TODO: we cannot add this until the very und when we see if the sobject is aliased
              rawValue: field,
            };
          }
          return output;
        } else {
          return this.visit(item);
        }
      });
    }
    return [];
  }

  selectClauseFunctionIdentifier(ctx: SelectClauseFunctionIdentifierContext): FieldRelationship {
    let output: FieldRelationship = {
      ...this.visit(ctx.fn),
    };
    if (ctx.alias) {
      output.alias = ctx.alias[0].image;
    }
    return output;
  }

  selectClauseSubqueryIdentifier(ctx: SelectClauseSubqueryIdentifierContext): FieldSubquery {
    return {
      type: 'FieldSubquery',
      subquery: this.visit(ctx.selectStatement, { isSubquery: true }),
    };
  }

  selectClauseTypeOf(ctx: SelectClauseTypeOfContext): FieldTypeOf {
    let conditions: FieldTypeOfCondition[] = ctx.selectClauseTypeOfThen.map((item: any) => this.visit(item));
    if (ctx.selectClauseTypeOfElse) {
      conditions.push(this.visit(ctx.selectClauseTypeOfElse));
    }
    return {
      type: 'FieldTypeof',
      field: ctx.typeOfField[0].image,
      conditions,
    };
  }

  selectClauseIdentifier(ctx: SelectClauseIdentifierContext): Field | FieldRelationship {
    const item = ctx.field[0];
    const alias = !!ctx.alias ? ctx.alias[0].image : undefined;
    const field: string = item.image;
    let output: FieldType;
    if (!field.includes('.')) {
      output = {
        type: 'Field',
        field: field,
        // objectPrefix: undefined, // TODO: we cannot add this until the very und when we see if the sobject is aliased
      };
    } else {
      const splitFields = field.split('.');
      output = {
        type: 'FieldRelationship',
        field: splitFields[splitFields.length - 1],
        relationships: splitFields.slice(0, splitFields.length - 1),
        // objectPrefix: undefined, // TODO: we cannot add this until the very und when we see if the sobject is aliased
        rawValue: field,
      };
    }
    if (alias) {
      output.alias = alias;
    }
    return output;
  }

  selectClauseTypeOfThen(ctx: SelectClauseTypeOfThenContext): FieldTypeOfCondition {
    return {
      type: 'WHEN',
      objectType: ctx.typeOfField[0].image,
      fieldList: ctx.field.map((item: any) => item.image),
    };
  }
  selectClauseTypeOfElse(ctx: SelectClauseTypeOfElseContext): FieldTypeOfCondition {
    return {
      type: 'ELSE',
      fieldList: ctx.field.map((item: any) => item.image),
    };
  }

  fromClause(ctx: FromClauseContext) {
    let sObject: string = ctx.Identifier[0].image;
    let output: any;
    if (sObject.includes('.')) {
      const sObjectPrefix = sObject.split('.');
      output = {
        sObjectPrefix: sObjectPrefix.slice(0, sObjectPrefix.length - 1),
        sObject: sObjectPrefix[sObjectPrefix.length - 1],
      };
    } else {
      output = {
        sObject,
      };
    }
    if (ctx.alias && ctx.alias[0]) {
      output.alias = ctx.alias[0].image;
    }
    return output;
  }

  usingScopeClause(ctx: usingScopeClauseContext) {
    return ctx.UsingScopeEnumeration[0].image;
  }

  whereClauseSubqueryIdentifier(ctx: WhereClauseSubqueryContext) {
    return this.visit(ctx.selectStatement, { isSubquery: false });
  }

  whereClause(ctx: WhereClauseContext): WhereClause {
    const where = ctx.conditionExpression.reduce(
      (expressions: ExpressionTree<WhereClause>, currExpression: any) => {
        if (!expressions.expressionTree) {
          expressions.expressionTree = this.visit(currExpression);
          expressions.prevExpression = expressions.expressionTree;
        } else {
          expressions.prevExpression.right = this.visit(currExpression, { prevExpression: expressions.prevExpression });
          expressions.prevExpression = expressions.prevExpression.right;
        }
        return expressions;
      },
      { prevExpression: undefined, expressionTree: undefined },
    );
    return where.expressionTree;
  }

  conditionExpression(ctx: ConditionExpressionContext, options?: { prevExpression?: any }) {
    options = options || {};
    if (options.prevExpression && ctx.logicalOperator) {
      options.prevExpression.operator = ctx.logicalOperator[0].tokenType.name;
    }
    return {
      left: this.visit(ctx.expression),
    };
  }
  withClause(ctx: WithClauseContext) {
    if (ctx.withSecurityEnforced) {
      return {
        withSecurityEnforced: true,
      };
    } else {
      return {
        withDataCategory: {
          conditions: this.visit(ctx.withDataCategory),
        },
      };
    }
  }
  withDataCategory(ctx: WithDateCategoryContext): WithDataCategoryCondition[] {
    return ctx.withDataCategoryArr.map(item => this.visit(item));
  }

  withDataCategoryArr(ctx: any): WithDataCategoryCondition {
    return {
      groupName: ctx.dataCategoryGroupName[0].image,
      selector: ctx.filteringSelector[0].image,
      parameters: ctx.dataCategoryName.map((item: any) => item.image),
    };
  }

  groupByClause(ctx: GroupByClauseContext): GroupByClause {
    let field = ctx.groupByFieldList ? ctx.groupByFieldList.map((item: any) => this.visit(item)) : undefined;
    if (field && field.length === 1) {
      field = field[0];
    }
    const output: GroupByClause = {};
    if (field) {
      output.field = field;
    }
    if (ctx.fn) {
      output.fn = this.visit(ctx.fn, { includeType: false });
    }
    if (ctx.havingClause) {
      output.having = this.visit(ctx.havingClause);
    }
    return output;
  }

  groupByFieldList(ctx: GroupByFieldListContext): string | string[] {
    if (ctx.field.length > 1) {
      return ctx.field.map((item: any) => item.image);
    } else {
      return ctx.field[0].image;
    }
  }

  havingClause(ctx: HavingClauseContext): HavingClause {
    // expressionWithAggregateFunction
    const having = ctx.conditionExpression.reduce(
      (expressions: ExpressionTree<HavingClause>, currExpression: any) => {
        if (!expressions.expressionTree) {
          expressions.expressionTree = this.visit(currExpression);
          expressions.prevExpression = expressions.expressionTree;
        } else {
          expressions.prevExpression.right = this.visit(currExpression, { prevExpression: expressions.prevExpression });
          expressions.prevExpression = expressions.prevExpression.right;
        }
        return expressions;
      },
      { prevExpression: undefined, expressionTree: undefined },
    );
    return having.expressionTree;
  }

  orderByClause(ctx: OrderByClauseContext): OrderByClause | OrderByClause[] {
    if (ctx.orderByExpressionOrFn.length === 1) {
      return this.visit(ctx.orderByExpressionOrFn);
    }
    return ctx.orderByExpressionOrFn.map(item => this.visit(item));
  }

  orderByExpression(ctx: OrderByExpressionContext): OrderByClause {
    const orderByClause: OrderByClause = {
      field: ctx.Identifier[0].image,
    };
    if (ctx.order && ctx.order[0]) {
      orderByClause.order = ctx.order[0].tokenType.name as OrderByCriterion;
    }
    if (ctx.nulls && ctx.nulls[0]) {
      orderByClause.nulls = ctx.nulls[0].tokenType.name as NullsOrder;
    }
    return orderByClause;
  }

  orderByFunctionExpression(ctx: OrderByFunctionExpressionContext): OrderByClause {
    const orderByClause: OrderByClause = {
      fn: this.$_getFieldFunction(ctx, false, false),
    };
    if (ctx.order && ctx.order[0]) {
      orderByClause.order = ctx.order[0].tokenType.name as OrderByCriterion;
    }
    if (ctx.nulls && ctx.nulls[0]) {
      orderByClause.nulls = ctx.nulls[0].tokenType.name as NullsOrder;
    }
    return orderByClause;
  }

  orderByLocationExpression(ctx: OrderByLocationExpressionContext): OrderByClause {
    const orderByClause: OrderByClause = {
      fn: this.visit(ctx.locationFunction, { includeType: false }),
    };
    if (ctx.order && ctx.order[0]) {
      orderByClause.order = ctx.order[0].tokenType.name as OrderByCriterion;
    }
    if (ctx.nulls && ctx.nulls[0]) {
      orderByClause.nulls = ctx.nulls[0].tokenType.name as NullsOrder;
    }
    return orderByClause;
  }

  limitClause(ctx: ValueContext) {
    return ctx.value[0].image;
  }

  offsetClause(ctx: ValueContext) {
    return ctx.value[0].image;
  }

  /**
   * @HELPER
   *
   * @param ctx
   * @param isAggregateFn
   */
  private $_getFieldFunction(ctx: FieldFunctionContext, isAggregateFn = false, includeType = true): FunctionExp | FieldFunctionExpression {
    const args = ctx.functionExpression
      ? ctx.functionExpression.map((node: any) => this.visit(ctx.functionExpression, { includeType })).flat()
      : [];
    const output: any = {};
    if (includeType) {
      output.type = 'FieldFunctionExpression';
    }
    output.functionName = ctx.fn[0].tokenType.name;
    output.parameters = args;
    if (includeType && isAggregateFn) {
      output.isAggregateFn = isAggregateFn;
    }
    output.rawValue = `${ctx.fn[0].image}(${args.map((arg: any) => (typeof arg === 'string' ? arg : arg.rawValue)).join(', ')})`;
    return output;
  }

  dateFunction(ctx: FieldFunctionContext, options: { includeType: boolean } = { includeType: true }) {
    return this.$_getFieldFunction(ctx, false, options.includeType);
  }

  aggregateFunction(ctx: FieldFunctionContext, options: { includeType: boolean } = { includeType: true }) {
    return this.$_getFieldFunction(ctx, true, options.includeType);
  }

  otherFunction(ctx: FieldFunctionContext, options: { includeType: boolean } = { includeType: true }) {
    return this.$_getFieldFunction(ctx, false, options.includeType);
  }

  cubeFunction(ctx: FieldFunctionContext) {
    return this.$_getFieldFunction(ctx, false, false);
  }

  rollupFunction(ctx: FieldFunctionContext) {
    return this.$_getFieldFunction(ctx, false, false);
  }

  locationFunction(ctx: LocationFunctionContext, options: { includeType: boolean } = { includeType: true }) {
    let output: any = {};
    if (options.includeType) {
      output.type = 'FieldFunctionExpression';
    }
    output = {
      ...output,
      ...{
        functionName: 'DISTANCE',
        parameters: [
          ctx.location1[0].image,
          isToken(ctx.location2) ? ctx.location2[0].image : this.visit(ctx.location2, options),
          ctx.unit[0].image,
        ],
      },
    };

    if (options.includeType) {
      output.isAggregateFn = true;
    }

    output.rawValue = `DISTANCE(${output.parameters[0]}, ${
      isString(output.parameters[1]) ? output.parameters[1] : output.parameters[1].rawValue
    }, ${output.parameters[2]})`;
    return output;
  }

  geolocationFunction(ctx: GeoLocationFunctionContext, options: { includeType: boolean } = { includeType: true }) {
    let output: any = {};
    if (options.includeType) {
      output.type = 'FieldFunctionExpression';
    }
    output = {
      ...output,
      ...{
        functionName: 'GEOLOCATION',
        parameters: [ctx.latitude[0].image, ctx.longitude[0].image],
        rawValue: `GEOLOCATION(${ctx.latitude[0].image}, ${ctx.longitude[0].image})`,
      },
    };
    return output;
  }

  functionExpression(ctx: FunctionExpressionContext, options: { includeType: boolean } = { includeType: true }): string[] {
    if (ctx.params) {
      return ctx.params.map((item: any) => {
        if (item.image) {
          return item.image;
        }
        return this.visit(item, options);
      });
    }
    return [];
  }

  expression(ctx: ExpressionContext): Condition & ValueQuery {
    // const { value, literalType, dateLiteralVariable } = this.visit(ctx.rhs, { returnLiteralType: true });
    const { value, literalType, dateLiteralVariable, operator } = this.visit(ctx.operator, { returnLiteralType: true });

    const output: Partial<Condition & ValueQuery> = {};

    if (ctx.logicalPrefix) {
      output.logicalPrefix = ctx.logicalPrefix[0].image as LogicalPrefix;
    }

    if (isToken(ctx.lhs)) {
      output.field = ctx.lhs[0].image;
    } else {
      output.fn = this.visit(ctx.lhs, { includeType: false });
    }

    // output.operator = this.visit(ctx.relationalOperator) || this.visit(ctx.setOperator);
    output.operator = operator;

    if (literalType === 'SUBQUERY') {
      output.valueQuery = value;
    } else {
      output.value = value;
      output.literalType = literalType;
    }

    if (dateLiteralVariable) {
      output.dateLiteralVariable = dateLiteralVariable;
    }

    if (ctx.L_PAREN) {
      output.openParen = ctx.L_PAREN.length;
    }
    if (ctx.R_PAREN) {
      output.closeParen = ctx.R_PAREN.length;
    }

    return output as Condition;
  }

  expressionWithRelationalOperator(ctx: ExpressionOperatorContext): Condition {
    return {
      operator: this.visit(ctx.relationalOperator) || this.visit(ctx.setOperator),
      ...this.visit(ctx.rhs, { returnLiteralType: true }),
    };
  }

  expressionWithSetOperator(ctx: ExpressionOperatorContext): Condition {
    return {
      operator: this.visit(ctx.relationalOperator) || this.visit(ctx.setOperator),
      ...this.visit(ctx.rhs, { returnLiteralType: true }),
    };
  }

  atomicExpression(ctx: AtomicExpressionContext, options?: { returnLiteralType?: boolean }) {
    options = options || {};
    let value;
    let literalType: LiteralTypeWithSubquery;
    let dateLiteralVariable;
    if (ctx.apexBindVariableExpression) {
      value = this.visit(ctx.apexBindVariableExpression);
      literalType = 'APEX_BIND_VARIABLE';
    } else if (ctx.NumberIdentifier) {
      value = ctx.NumberIdentifier[0].image;
      literalType = this.$_getLiteralTypeFromTokenType(ctx.NumberIdentifier[0].tokenType.name);
    } else if (ctx.UnsignedInteger) {
      value = ctx.UnsignedInteger[0].image;
      literalType = 'INTEGER';
    } else if (ctx.SignedInteger) {
      value = ctx.SignedInteger[0].image;
      literalType = 'INTEGER';
    } else if (ctx.RealNumber) {
      value = ctx.RealNumber[0].image;
      literalType = 'DECIMAL';
    } else if (ctx.DateIdentifier) {
      value = ctx.DateIdentifier[0].image;
      literalType = this.$_getLiteralTypeFromTokenType(ctx.DateIdentifier[0].tokenType.name);
    } else if (ctx.CurrencyPrefixedInteger) {
      value = ctx.CurrencyPrefixedInteger[0].image;
      literalType = 'INTEGER_WITH_CURRENCY_PREFIX';
    } else if (ctx.CurrencyPrefixedDecimal) {
      value = ctx.CurrencyPrefixedDecimal[0].image;
      literalType = 'DECIMAL_WITH_CURRENCY_PREFIX';
    } else if (ctx.DateTime) {
      value = ctx.DateTime[0].image;
      literalType = 'DATETIME';
    } else if (ctx.date) {
      value = ctx.DateToken[0].image;
      literalType = 'DATE';
    } else if (ctx.NULL) {
      value = 'NULL';
      literalType = 'NULL';
    } else if (ctx.StringIdentifier) {
      value = ctx.StringIdentifier[0].image;
      literalType = 'STRING';
    } else if (ctx.Identifier) {
      value = ctx.Identifier[0].image;
      literalType = 'STRING';
    } else if (ctx.booleanValue) {
      value = this.visit(ctx.booleanValue);
      literalType = 'BOOLEAN';
    } else if (ctx.DateLiteral) {
      value = ctx.DateLiteral[0].image;
      literalType = 'DATE_LITERAL';
    } else if (ctx.dateNLiteral) {
      const valueAndVariable = this.visit(ctx.dateNLiteral);
      value = valueAndVariable.value;
      dateLiteralVariable = valueAndVariable.variable;
      literalType = 'DATE_N_LITERAL';
    } else if (ctx.arrayExpression) {
      const arrayValues: ArrayExpressionWithType[] = this.visit(ctx.arrayExpression);
      value = arrayValues.map((item: any) => item.value);
      const dateLiteralTemp = arrayValues.map((item: any) => item.variable || null);
      const hasDateLiterals = dateLiteralTemp.some(item => !isNull(item));
      if (new Set(arrayValues.map((item: any) => item.type)).size === 1) {
        literalType = this.$_getLiteralTypeFromTokenType(arrayValues[0].type);
      } else {
        literalType = arrayValues.map((item: any) => this.$_getLiteralTypeFromTokenType(item.type));
      }
      if (hasDateLiterals) {
        dateLiteralVariable = dateLiteralTemp;
      }
      literalType = literalType || 'STRING';
    } else if (ctx.whereClauseSubqueryIdentifier) {
      value = this.visit(ctx.whereClauseSubqueryIdentifier);
      literalType = 'SUBQUERY';
    }
    if (options.returnLiteralType) {
      return {
        value,
        literalType,
        dateLiteralVariable,
      };
    } else {
      return value;
    }
  }

  apexBindVariableExpression(ctx: ApexBindVariableExpressionContext): string {
    return ctx.Identifier[0].image;
  }

  arrayExpression(ctx: ValueContext): ArrayExpressionWithType[] {
    return ctx.value.map((item: any) => {
      if (isToken(item)) {
        return {
          type: (item as IToken).tokenType.name,
          value: (item as IToken).image,
        };
      } else {
        return this.visit(item, { includeType: true });
      }
    });
  }

  relationalOperator(ctx: OperatorContext) {
    return ctx.operator[0].image;
  }

  setOperator(ctx: OperatorContext) {
    return ctx.operator[0].tokenType.name.replace('_', ' ');
  }

  booleanValue(ctx: BooleanContext) {
    return ctx.boolean[0].tokenType.name;
  }

  dateNLiteral(ctx: DateNLiteralContext, options?: { includeType: true }) {
    const output: any = {
      value: `${ctx.dateNLiteral[0].image}:${ctx.variable[0].image}`,
      variable: Number(ctx.variable[0].image),
    };
    if (options && options.includeType) {
      output.type = ctx.dateNLiteral[0].tokenType.name;
    }
    return output;
  }

  forViewOrReference(ctx: ValueContext) {
    return ctx.value[0].tokenType.name;
  }

  updateTrackingViewstat(ctx: ValueContext) {
    return ctx.value[0].tokenType.name;
  }

  private $_getLiteralTypeFromTokenType(tokenTypeName: string | DateLiteral | DateNLiteral): LiteralType {
    if (tokenTypeName === 'REAL_NUMBER') {
      return 'DECIMAL';
    } else if (tokenTypeName === 'CURRENCY_PREFIXED_DECIMAL') {
      return 'DECIMAL_WITH_CURRENCY_PREFIX';
    } else if (tokenTypeName === 'CURRENCY_PREFIXED_INTEGER') {
      return 'INTEGER_WITH_CURRENCY_PREFIX';
    } else if (tokenTypeName === 'SIGNED_DECIMAL') {
      return 'DECIMAL';
    } else if (tokenTypeName === 'UNSIGNED_DECIMAL') {
      return 'DECIMAL';
    } else if (tokenTypeName === 'UNSIGNED_INTEGER') {
      return 'INTEGER';
    } else if (tokenTypeName === 'SIGNED_INTEGER') {
      return 'INTEGER';
    } else if (tokenTypeName === 'DATETIME') {
      return 'DATETIME';
    } else if (tokenTypeName === 'DATE') {
      return 'DATE';
    } else if (tokenTypeName === 'NULL') {
      return 'NULL';
    } else if (tokenTypeName === 'StringIdentifier') {
      return 'STRING';
    } else if (tokenTypeName === 'Identifier') {
      return 'STRING';
    } else if (BOOLEANS.includes(tokenTypeName)) {
      return 'BOOLEAN';
    } else if (DATE_LITERALS.includes(tokenTypeName as DateLiteral)) {
      return 'DATE_LITERAL';
    } else if (DATE_N_LITERALS.includes(tokenTypeName as DateNLiteral)) {
      return 'DATE_N_LITERAL';
    } else {
      return 'STRING';
    }
  }
}

// Our visitor has no state, so a single instance is sufficient.
const visitor = new SOQLVisitor();

/**
 * Parse query and process results
 * @param soql
 */
export function parseQuery(soql: string, options?: ParseQueryConfig): Query {
  const query: Query = visitor.visit(parse(soql, options));
  return query;
}

/**
 * Lex and parse query (without walking parsed results)
 * to determine if query is valid
 * @param soql
 */
export function isQueryValid(soql: string, options?: ParseQueryConfig): boolean {
  try {
    parse(soql, options);
    return true;
  } catch (ex) {
    return false;
  }
}
